// Recorder screen: record camera+mic or audio only, keep clips in the app
// (IndexedDB), trim them and save them to disk. An optional practice
// metronome plays along; it is only mixed into the recording if asked.

import { useCallback, useEffect, useRef, useState } from "react";
import { Circle, Download, Flag, Metronome as MetronomeIcon, Scissors, Square, Trash2, Video } from "lucide-react";
import type { Settings } from "../../model";
import { FreeMetronome, FREE_MAX_BPM, FREE_MIN_BPM, MAX_BEATS_PER_BAR, getAudioContext, resumeAudio } from "../../audio";
import {
  ClipRecorder,
  defaultClipName,
  deleteClip,
  extensionFor,
  formatClipTime,
  listClips,
  openInput,
  renameClip,
  safeFileName,
  saveBlobToDisk,
  saveClip,
  trimClip,
  stopStream,
  type ClipFlag,
  type ClipRecord,
} from "../../recording";
import { Field, Segmented, Stepper } from "../components/Controls";
import { ClipTrimmer, isFlagHotkey } from "../components/ClipTrimmer";
import { LiveWaveform } from "../components/LiveWaveform";
import { useShell } from "../shell/AppShellContext";
import st from "./Recorder.module.css";

type InputMode = "video" | "audio";

function formatSize(bytes: number): string {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(2)} GB` : `${(bytes / 1e6).toFixed(1)} MB`;
}

export function RecorderScreen({ settings }: { settings: Settings }) {
  const { toast } = useShell();
  const [mode, setMode] = useState<InputMode>("video");
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const recorderRef = useRef<ClipRecorder | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  // Flags dropped during the current take (ref for the stop/unmount paths, state for the button).
  const flagsRef = useRef<ClipFlag[]>([]);
  const [flagCount, setFlagCount] = useState(0);

  const [clips, setClips] = useState<ClipRecord[]>([]);
  const [trimId, setTrimId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Practice metronome.
  const [bpm, setBpm] = useState(100);
  const [beatsPerBar, setBeatsPerBar] = useState(4);
  const [clickOn, setClickOn] = useState(false);
  const [clickInRecording, setClickInRecording] = useState(false);
  const metroRef = useRef<FreeMetronome | null>(null);
  const metro = () => (metroRef.current ??= new FreeMetronome(getAudioContext()));

  const refresh = useCallback(async () => {
    try {
      setClips(await listClips());
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }, [toast]);

  useEffect(() => void refresh(), [refresh]);
  useEffect(() => metro().setBpm(bpm), [bpm]);
  useEffect(() => metro().setBeatsPerBar(beatsPerBar), [beatsPerBar]);
  useEffect(() => metro().setVolume(settings.metronomeVolume), [settings.metronomeVolume]);

  useEffect(() => {
    if (previewRef.current) previewRef.current.srcObject = stream;
  }, [stream]);

  // Leaving the screen: keep any in-progress take, then release camera/mic and the click.
  const streamRef = useRef(stream);
  streamRef.current = stream;
  useEffect(
    () => () => {
      const rec = recorderRef.current;
      recorderRef.current = null;
      const flags = flagsRef.current;
      const input = streamRef.current;
      const finish = rec
        ? rec
            .stop()
            .then((r) => (r.blob.size > 0 ? saveClip({ name: defaultClipName(new Date()), createdAt: Date.now(), ...r, flags }) : null))
            .catch((err) => toast(err instanceof Error ? err.message : String(err), "error"))
        : Promise.resolve();
      void finish.finally(() => stopStream(input));
      metroRef.current?.stop();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed(recorderRef.current?.elapsedSec() ?? 0), 200);
    return () => clearInterval(id);
  }, [recording]);

  function addFlag() {
    const rec = recorderRef.current;
    if (!rec) return;
    const timeSec = Math.round(rec.elapsedSec() * 10) / 10;
    const n = flagsRef.current.length + 1;
    flagsRef.current = [...flagsRef.current, { id: crypto.randomUUID(), timeSec, label: `Flag ${n}` }];
    setFlagCount(n);
    toast(`Flag at ${formatClipTime(timeSec)}`, "info");
  }

  // Latest addFlag for the key listener, which is registered once per recording.
  const addFlagRef = useRef(addFlag);
  addFlagRef.current = addFlag;
  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      if (isFlagHotkey(e)) {
        e.preventDefault();
        addFlagRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [recording]);

  async function enableInput(next: InputMode) {
    setInputError(null);
    stopStream(stream);
    setStream(null);
    try {
      void resumeAudio(); // still inside the click: lets the live waveform's analyser run
      setStream(await openInput(next === "video"));
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      setInputError(
        name === "NotAllowedError"
          ? "Camera/microphone access was blocked. Allow it in the browser's site settings and try again."
          : name === "NotFoundError"
            ? `No ${next === "video" ? "camera or microphone" : "microphone"} found.`
            : err instanceof Error
              ? err.message
              : String(err)
      );
    }
  }

  function changeMode(next: InputMode) {
    setMode(next);
    if (stream) void enableInput(next);
  }

  async function toggleClick() {
    const m = metro();
    if (m.isRunning()) {
      m.stop();
      setClickOn(false);
    } else {
      await resumeAudio();
      m.start();
      setClickOn(true);
    }
  }

  async function startRecording() {
    if (!stream) return;
    try {
      if (clickInRecording) await resumeAudio();
      const rec = new ClipRecorder(stream, clickInRecording);
      metro().setExtraOutput(rec.mixInput);
      rec.start();
      recorderRef.current = rec;
      flagsRef.current = [];
      setFlagCount(0);
      setElapsed(0);
      setRecording(true);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    if (!rec) return;
    recorderRef.current = null;
    const flags = flagsRef.current;
    setRecording(false);
    metro().setExtraOutput(null);
    try {
      const result = await rec.stop();
      if (result.blob.size === 0) throw new Error("The recording was empty.");
      await saveClip({ name: defaultClipName(new Date()), createdAt: Date.now(), ...result, flags });
      await refresh();
      toast("Recording saved.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteClip(id);
      if (trimId === id) setTrimId(null);
      setConfirmDeleteId(null);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function handleRename(clip: ClipRecord, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === clip.name) return;
    try {
      await renameClip(clip.id, trimmed);
      await refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const [convertingId, setConvertingId] = useState<string | null>(null);

  /** Converts the whole (untrimmed) audio clip to MP3, then saves it. */
  async function downloadMp3(clip: ClipRecord) {
    setConvertingId(clip.id);
    try {
      const out = await trimClip(clip.blob, { sourceMime: clip.mimeType, hasVideo: false, mode: "exact", audioFormat: "mp3" });
      await saveBlobToDisk(out.blob, `${safeFileName(clip.name)}.mp3`);
    } catch (err) {
      toast(`MP3 conversion failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setConvertingId(null);
    }
  }

  async function download(clip: ClipRecord) {
    try {
      await saveBlobToDisk(clip.blob, `${safeFileName(clip.name)}.${extensionFor(clip.mimeType, clip.hasVideo)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  const trimClipRecord = clips.find((c) => c.id === trimId) ?? null;

  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Recorder</h2>
      </div>

      <div className={st.layout}>
        <section className={st.card}>
          <div className={st.cardHeader}>
            <Segmented
              label="Input"
              value={mode}
              options={[
                { value: "video", label: "Video + audio" },
                { value: "audio", label: "Audio only" },
              ]}
              onChange={(v) => !recording && changeMode(v)}
            />
            {recording && (
              <span className={st.recBadge}>
                <span className={st.recDot} /> REC {formatClipTime(elapsed)}
              </span>
            )}
          </div>

          {mode === "video" ? (
            <div className={st.preview}>
              {stream ? <video ref={previewRef} autoPlay muted playsInline className={st.previewVideo} /> : <Video size={40} className={st.previewIcon} />}
            </div>
          ) : (
            !stream && (
              <div className={`${st.preview} ${st.previewAudio}`}>
                <span className={st.previewText}>Microphone off</span>
              </div>
            )
          )}
          {stream && <LiveWaveform stream={stream} recording={recording} />}

          {inputError && <div className="notice notice-error">{inputError}</div>}

          <div className={st.actions}>
            {!stream ? (
              <button className="btn-primary" onClick={() => void enableInput(mode)}>
                Enable {mode === "video" ? "camera & mic" : "mic"}
              </button>
            ) : recording ? (
              <>
                <button className={`btn-danger ${st.iconBtn}`} onClick={() => void stopRecording()}>
                  <Square size={14} fill="currentColor" /> Stop
                </button>
                <button className={st.iconBtn} onClick={addFlag}>
                  <Flag size={14} /> Flag{flagCount > 0 && ` (${flagCount})`} <kbd className={st.kbd}>M</kbd>
                </button>
              </>
            ) : (
              <button className={`btn-primary ${st.iconBtn}`} onClick={() => void startRecording()}>
                <Circle size={14} fill="currentColor" /> Record
              </button>
            )}
            {stream && !recording && (
              <button className="btn-ghost" onClick={() => { stopStream(stream); setStream(null); }}>
                Turn off {mode === "video" ? "camera" : "mic"}
              </button>
            )}
          </div>

          {stream && !recording && <p className={st.hint}>Press M while recording to drop a flag</p>}

          <div className={st.metro}>
            <span className={st.metroTitle}>
              <MetronomeIcon size={15} /> Practice click
            </span>
            <Field label="BPM">
              <Stepper label="BPM" value={bpm} onChange={setBpm} min={FREE_MIN_BPM} max={FREE_MAX_BPM} />
            </Field>
            <Field label="Beats per bar">
              <Stepper label="Beats per bar" value={beatsPerBar} onChange={setBeatsPerBar} min={1} max={MAX_BEATS_PER_BAR} />
            </Field>
            <button className={clickOn ? "btn-primary" : undefined} onClick={() => void toggleClick()}>
              {clickOn ? "Click on" : "Click off"}
            </button>
            <label className={st.check} title={recording ? "Can't change while recording" : undefined}>
              <input
                type="checkbox"
                checked={clickInRecording}
                disabled={recording}
                onChange={(e) => setClickInRecording(e.target.checked)}
              />
              Include click in recording
            </label>
          </div>
        </section>

        <section className={st.card}>
          <h3 className={st.sectionTitle}>Clips</h3>
          {clips.length === 0 ? (
            <p className={st.empty}>No recordings yet.</p>
          ) : (
            <ul className={st.clipList}>
              {clips.map((c) => (
                <li key={c.id} className={`${st.clip}${trimId === c.id ? ` ${st.clipActive}` : ""}`}>
                  <div className={st.clipInfo}>
                    <input
                      className={st.clipName}
                      defaultValue={c.name}
                      key={c.name}
                      aria-label="Clip name"
                      onBlur={(e) => void handleRename(c, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                    />
                    <span className={st.clipMeta}>
                      {c.hasVideo ? "Video" : "Audio"} · {formatClipTime(c.durationSec)} · {formatSize(c.size)} ·{" "}
                      {extensionFor(c.mimeType, c.hasVideo).toUpperCase()}
                      {c.flags && c.flags.length > 0 && ` · ${c.flags.length} ${c.flags.length === 1 ? "flag" : "flags"}`}
                    </span>
                  </div>
                  {confirmDeleteId === c.id ? (
                    <div className={st.clipActions}>
                      <span className={st.clipMeta}>Delete?</span>
                      <button className="btn-danger" onClick={() => void handleDelete(c.id)}>
                        Delete
                      </button>
                      <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className={st.clipActions}>
                      <button className="btn-ghost" onClick={() => setTrimId(trimId === c.id ? null : c.id)} title="Play / trim">
                        <Scissors size={15} />
                      </button>
                      <button className="btn-ghost" onClick={() => void download(c)} title="Save to computer">
                        <Download size={15} />
                      </button>
                      {!c.hasVideo && (
                        <button
                          className={`btn-ghost ${st.mp3Btn}`}
                          onClick={() => void downloadMp3(c)}
                          disabled={convertingId !== null}
                          title="Save as MP3"
                        >
                          {convertingId === c.id ? "…" : "MP3"}
                        </button>
                      )}
                      <button className="btn-ghost" onClick={() => setConfirmDeleteId(c.id)} title="Delete">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {trimClipRecord && (
          <section className={`${st.card} ${st.wide}`}>
            <ClipTrimmer
              key={trimClipRecord.id}
              clip={trimClipRecord}
              onClose={() => setTrimId(null)}
              onSavedAsClip={() => void refresh()}
              onFlagsChanged={() => void refresh()}
            />
          </section>
        )}
      </div>
    </div>
  );
}
