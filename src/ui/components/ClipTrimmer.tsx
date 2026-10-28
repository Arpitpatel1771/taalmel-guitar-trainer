// Clip player + trimmer: pick start/end on the clip (the video follows the
// handles), preview or loop the selection, then trim with ffmpeg.wasm and
// save to disk or back into the clip list.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Flag, Pause, Play, Repeat, Trash2, X } from "lucide-react";
import {
  extensionFor,
  formatClipTime,
  parseClipTime,
  safeFileName,
  saveBlobToDisk,
  saveClip,
  shiftFlagsIntoRange,
  trimClip,
  updateClipFlags,
  updateClipPeaks,
  computeClipPeaks,
  windowAround,
  type ClipFlag,
  type ClipRecord,
  type TrimMode,
  type AudioFormat,
  type TrimStage,
} from "../../recording";
import { Field, NumberInput, Segmented } from "./Controls";
import { WaveformCanvas } from "./WaveformCanvas";
import { useShell } from "../shell/AppShellContext";
import st from "../screens/Recorder.module.css";

const MIN_LENGTH_SEC = 0.1;
/** Range-input thumb width (px) in Recorder.module.css: thumb centres run from THUMB/2 to width - THUMB/2. */
const THUMB_PX = 14;

/** Plain M key (no modifiers, not repeating, not typing in a field): the "drop a flag" hotkey. */
export function isFlagHotkey(e: KeyboardEvent): boolean {
  if (e.key !== "m" && e.key !== "M") return false;
  if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return false;
  const t = e.target as HTMLElement | null;
  return !(t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable));
}
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Typed m:ss time field: free typing, parsed on blur/Enter, Escape reverts. */
function TimeInput({ value, onCommit, label }: { value: number; onCommit: (sec: number) => void; label: string }) {
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const sec = parseClipTime(draft);
    if (sec !== null) onCommit(sec);
    setDraft(null);
  }
  return (
    <input
      className={st.timeInput}
      aria-label={label}
      title="m:ss, e.g. 4:17 or 4:17.5"
      value={draft ?? formatClipTime(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** A clip whose media is on this device: the trimmer never receives a null blob. */
export type PlayableClip = ClipRecord & { blob: Blob };

export function ClipTrimmer({
  clip,
  onClose,
  onSavedAsClip,
  onFlagsChanged,
}: {
  clip: PlayableClip;
  onClose: () => void;
  onSavedAsClip: () => void;
  onFlagsChanged?: () => void;
}) {
  const { toast } = useShell();
  // Created in an effect (not useMemo) so StrictMode's mount/unmount/mount
  // can't leave the player pointing at an already-revoked URL.
  const [url, setUrl] = useState<string | null>(null);
  // Keyed on the clip id, not the blob: re-listing clips (e.g. after a flag
  // edit) returns a new Blob object for the same media, and reloading the
  // player would lose the playhead.
  useEffect(() => {
    const u = URL.createObjectURL(clip.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);

  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  // Stored duration first: WebM recordings often report Infinity until fully read.
  const [duration, setDuration] = useState(clip.durationSec);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(clip.durationSec);
  const [current, setCurrent] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [mode, setMode] = useState<TrimMode>("exact");
  const [audioFormat, setAudioFormat] = useState<AudioFormat>("m4a");
  const mp3 = !clip.hasVideo && audioFormat === "mp3";
  const [flags, setFlags] = useState<ClipFlag[]>(clip.flags ?? []);
  // Waveform: computed once per clip, then stored with it.
  const [peaks, setPeaks] = useState<number[] | null>(clip.peaks ?? null);
  const [peaksState, setPeaksState] = useState<"ready" | "computing" | "failed">(clip.peaks ? "ready" : "computing");
  useEffect(() => {
    if (clip.peaks) return;
    let cancelled = false;
    void computeClipPeaks(clip.blob, clip.mimeType, clip.hasVideo)
      .then(async (p) => {
        if (cancelled) return;
        setPeaks(p);
        setPeaksState("ready");
        await updateClipPeaks(clip.id, p);
        onFlagsChanged?.(); // refresh the list so reopening the clip is instant
      })
      .catch(() => !cancelled && setPeaksState("failed"));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clip.id]);
  const [padSec, setPadSec] = useState(10);
  const [busy, setBusy] = useState<{ stage: TrimStage; fraction: number | null } | null>(null);
  /** True while playing the selection (Preview): stop or loop at the end handle. */
  const inSelectionRef = useRef(false);
  const fixingDurationRef = useRef(false);

  // Live values for the animation-frame loop.
  const live = useRef({ start, end, loop });
  live.current = { start, end, loop };

  function adoptDuration(d: number) {
    // An untouched end handle follows the real length; a moved one is only clamped.
    setEnd((e) => (e >= duration - 0.15 ? d : Math.min(e, d)));
    setDuration(d);
  }

  function onLoadedMetadata() {
    const el = mediaRef.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) {
      adoptDuration(el.duration);
      el.currentTime = 0.001; // decode and show the first frame instead of black
    } else {
      // WebM without a duration: seeking far past the end makes the browser
      // scan to the end and report the real length (handled in durationchange).
      fixingDurationRef.current = true;
      el.currentTime = 1e101;
    }
  }

  // Also fires when the browser refines the length after loading more data.
  function onDurationChange() {
    const el = mediaRef.current;
    if (!el || !Number.isFinite(el.duration) || Math.abs(el.duration - duration) < 0.001) return;
    adoptDuration(el.duration);
    if (fixingDurationRef.current) {
      fixingDurationRef.current = false;
      el.currentTime = 0.001;
    }
  }

  // Smooth playhead + selection stop/loop while playing (timeupdate only fires ~4x/s).
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const el = mediaRef.current;
      if (el) {
        const { start: s, end: e, loop: lp } = live.current;
        if (inSelectionRef.current && el.currentTime >= e) {
          if (lp) el.currentTime = s;
          else {
            el.pause();
            el.currentTime = e;
          }
        }
        setCurrent(el.currentTime);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  function seek(t: number) {
    const el = mediaRef.current;
    const clamped = Math.max(0, Math.min(duration, t));
    if (el) el.currentTime = clamped;
    setCurrent(clamped);
  }

  /** Dragging a handle pauses playback and shows that exact frame. */
  function scrubTo(t: number) {
    const el = mediaRef.current;
    if (el && !el.paused) el.pause();
    inSelectionRef.current = false;
    seek(t);
  }

  function updateStart(v: number) {
    const s = Math.max(0, Math.min(v, end - MIN_LENGTH_SEC));
    setStart(s);
    scrubTo(s);
  }

  function updateEnd(v: number) {
    const e = Math.min(duration, Math.max(v, start + MIN_LENGTH_SEC));
    setEnd(e);
    scrubTo(e);
  }

  function playSelection() {
    const el = mediaRef.current;
    if (!el) return;
    if (!el.paused && inSelectionRef.current) {
      el.pause();
      return;
    }
    inSelectionRef.current = true;
    if (el.currentTime < start || el.currentTime >= end - 0.05) el.currentTime = start;
    void el.play().catch((err) => toast(`Can't play this clip: ${err instanceof Error ? err.message : String(err)}`, "error"));
  }

  /** Click (or drag) on the bar, outside the handles, moves the playhead. */
  function onTrackPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).tagName === "INPUT") return; // a handle
    const track = trackRef.current;
    if (!track) return;
    const toTime = (clientX: number) => {
      const r = track.getBoundingClientRect();
      const f = (clientX - r.left - THUMB_PX / 2) / Math.max(1, r.width - THUMB_PX);
      return Math.max(0, Math.min(1, f)) * duration;
    };
    scrubTo(toTime(e.clientX));
    track.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => scrubTo(toTime(ev.clientX));
    const up = () => {
      track.removeEventListener("pointermove", move);
      track.removeEventListener("pointerup", up);
    };
    track.addEventListener("pointermove", move);
    track.addEventListener("pointerup", up);
  }

  /** Saves the new flag list (kept sorted by time) and tells the clip list to refresh. */
  function commitFlags(next: ClipFlag[]) {
    const sorted = [...next].sort((a, b) => a.timeSec - b.timeSec);
    setFlags(sorted);
    updateClipFlags(clip.id, sorted).then(
      () => onFlagsChanged?.(),
      (err) => toast(err instanceof Error ? err.message : String(err), "error")
    );
  }

  function addFlagAtPlayhead() {
    const timeSec = round1(current);
    commitFlags([...flags, { id: crypto.randomUUID(), timeSec, label: `Flag ${flags.length + 1}` }]);
    toast(`Flag at ${formatClipTime(timeSec)}`, "info");
  }

  function aroundFlag(f: ClipFlag) {
    const w = windowAround(f.timeSec, padSec, duration);
    const e = Math.min(duration, Math.max(w.end, w.start + MIN_LENGTH_SEC));
    setStart(w.start);
    setEnd(e);
    scrubTo(w.start);
  }

  // The M hotkey drops a flag at the playhead (latest handler via ref, listener added once).
  const addFlagRef = useRef(addFlagAtPlayhead);
  addFlagRef.current = addFlagAtPlayhead;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isFlagHotkey(e)) {
        e.preventDefault();
        addFlagRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  async function runTrim(): Promise<{ blob: Blob; mimeType: string } | null> {
    try {
      return await trimClip(
        clip.blob,
        { sourceMime: clip.mimeType, hasVideo: clip.hasVideo, startSec: start, endSec: end, mode, audioFormat },
        (stage, fraction) => setBusy({ stage, fraction })
      );
    } catch (err) {
      toast(`Trim failed: ${err instanceof Error ? err.message : String(err)}`, "error");
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function trimAndDownload() {
    const out = await runTrim();
    if (!out) return;
    try {
      await saveBlobToDisk(out.blob, `${safeFileName(clip.name)} (trimmed).${extensionFor(out.mimeType, clip.hasVideo)}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  async function trimAndKeep() {
    const out = await runTrim();
    if (!out) return;
    try {
      await saveClip({
        name: `${clip.name} (trimmed)`,
        createdAt: Date.now(),
        mimeType: out.mimeType,
        hasVideo: clip.hasVideo,
        durationSec: end - start,
        blob: out.blob,
        flags: shiftFlagsIntoRange(flags, start, end),
      });
      onSavedAsClip();
      toast("Trimmed clip added.");
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }

  /** Same horizontal mapping as the native thumbs, so bar, playhead and handles line up. */
  const at = (t: number) => `calc(${THUMB_PX / 2}px + (100% - ${THUMB_PX}px) * ${duration > 0 ? t / duration : 0})`;
  const busyLabel =
    busy?.stage === "loading"
      ? "Loading trimmer…"
      : busy
        ? `Trimming… ${busy.fraction !== null ? `${Math.round(busy.fraction * 100)}%` : ""}`
        : null;

  const mediaProps = {
    ref: mediaRef,
    src: url ?? undefined,
    controls: true,
    preload: "auto",
    onLoadedMetadata,
    onDurationChange,
    onPlay: () => setPlaying(true),
    onPause: () => {
      setPlaying(false);
      setCurrent(mediaRef.current?.currentTime ?? 0);
    },
    // Native-controls seeks while paused.
    onSeeked: () => !fixingDurationRef.current && setCurrent(mediaRef.current?.currentTime ?? 0),
    onError: () => toast("This clip can't be played in this browser.", "error"),
  } as const;

  return (
    <div className={st.trimmer}>
      <div className={st.cardHeader}>
        <h3 className={st.sectionTitle}>{clip.name}</h3>
        <button className="btn-ghost" onClick={onClose} aria-label="Close trimmer">
          <X size={16} />
        </button>
      </div>

      {clip.hasVideo ? <video {...mediaProps} playsInline className={st.player} /> : <audio {...mediaProps} className={st.audioPlayer} />}

      <div ref={trackRef} className={st.rangeTrack} onPointerDown={onTrackPointerDown}>
        <WaveformCanvas className={st.waveform} peaks={peaks} duration={duration} start={start} end={end} />
        {peaksState !== "ready" && (
          <span className={st.waveStatus}>{peaksState === "computing" ? "Drawing waveform…" : "Waveform unavailable"}</span>
        )}
        <div className={st.playhead} style={{ left: at(current) }} aria-hidden />
        <input
          type="range"
          className={st.rangeThumb}
          min={0}
          max={duration}
          step="any"
          value={start}
          aria-label="Trim start"
          onChange={(e) => updateStart(Number(e.target.value))}
        />
        <input
          type="range"
          className={st.rangeThumb}
          min={0}
          max={duration}
          step="any"
          value={end}
          aria-label="Trim end"
          onChange={(e) => updateEnd(Number(e.target.value))}
        />
        {flags.map((f) => (
          <div key={f.id} className={st.flagMarker} style={{ left: at(f.timeSec) }}>
            <button
              className={st.flagHead}
              title={`${f.label} · ${formatClipTime(f.timeSec)}`}
              aria-label={`Jump to ${f.label}`}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => scrubTo(f.timeSec)}
            />
          </div>
        ))}
      </div>
      <div className={st.trackLabels}>
        <span>0:00.0</span>
        <span className={st.nowLabel}>{formatClipTime(current)}</span>
        <span>{formatClipTime(duration)}</span>
      </div>

      <div className={st.trimFields}>
        <Field label="Start">
          <div className={st.inline}>
            <TimeInput label="Trim start" value={start} onCommit={updateStart} />
            <button className="btn-ghost" onClick={() => updateStart(round1(current))}>
              Set to playhead
            </button>
          </div>
        </Field>
        <Field label="End">
          <div className={st.inline}>
            <TimeInput label="Trim end" value={end} onCommit={updateEnd} />
            <button className="btn-ghost" onClick={() => updateEnd(round1(current))}>
              Set to playhead
            </button>
          </div>
        </Field>
        <Field label={`Selection · ${formatClipTime(end - start)}`}>
          <div className={st.inline}>
            <button className={`btn-primary ${st.iconBtn}`} onClick={playSelection}>
              {playing && inSelectionRef.current ? <Pause size={14} /> : <Play size={14} />}
              {playing && inSelectionRef.current ? "Pause" : "Play selection"}
            </button>
            <button
              className={`${loop ? "btn-primary" : "btn-ghost"} ${st.iconBtn}`}
              aria-pressed={loop}
              onClick={() => setLoop((l) => !l)}
              title="Repeat the selection"
            >
              <Repeat size={14} /> Loop
            </button>
          </div>
        </Field>
      </div>

      <Field label="Flags">
        <div className={st.trimmer}>
          <div className={st.flagsHeader}>
            <button className={st.iconBtn} onClick={addFlagAtPlayhead}>
              <Flag size={14} /> Add flag at playhead <kbd className={st.kbd}>M</kbd>
            </button>
            <label className={st.inline}>
              Around ±
              <NumberInput
                className={st.padInput}
                aria-label="Around padding in seconds"
                value={padSec}
                min={1}
                max={600}
                onCommit={(v) => v !== null && setPadSec(v)}
              />
              s
            </label>
          </div>
          {flags.length === 0 ? (
            <p className={st.hint}>No flags. Press M while recording or reviewing to add one.</p>
          ) : (
            <ul className={st.flagList}>
              {flags.map((f) => (
                <li key={f.id} className={st.flagRow}>
                  <span className={st.flagTime}>{formatClipTime(f.timeSec)}</span>
                  <input
                    className={st.flagLabel}
                    defaultValue={f.label}
                    key={f.label}
                    aria-label="Flag label"
                    onBlur={(e) => {
                      const label = e.target.value.trim();
                      if (label && label !== f.label) commitFlags(flags.map((x) => (x.id === f.id ? { ...x, label } : x)));
                      else e.target.value = f.label;
                    }}
                    onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                  />
                  <button className="btn-ghost" onClick={() => scrubTo(f.timeSec)}>
                    Jump
                  </button>
                  <button className="btn-ghost" onClick={() => updateStart(f.timeSec)}>
                    Start here
                  </button>
                  <button className="btn-ghost" onClick={() => updateEnd(f.timeSec)}>
                    End here
                  </button>
                  <button className="btn-ghost" onClick={() => aroundFlag(f)}>
                    Around
                  </button>
                  <button className="btn-ghost" onClick={() => commitFlags(flags.filter((x) => x.id !== f.id))} title="Delete flag" aria-label="Delete flag">
                    <Trash2 size={15} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Field>

      <div className={st.inline}>
        {!clip.hasVideo && (
          <Field label="Format">
            <Segmented
              label="Audio format"
              value={audioFormat}
              options={[
                { value: "m4a", label: "M4A" },
                { value: "mp3", label: "MP3" },
              ]}
              onChange={setAudioFormat}
            />
          </Field>
        )}
        {!mp3 && (
          <Field label="Cut">
            <Segmented
              label="Cut mode"
              value={mode}
              options={[
                { value: "exact", label: `Exact (${clip.hasVideo ? "MP4" : "M4A"}, re-encode)` },
                { value: "fast", label: "Fast (keyframe, original format)" },
              ]}
              onChange={setMode}
            />
          </Field>
        )}
      </div>
      <p className={st.hint}>
        {mp3
          ? "Frame-accurate. Re-encodes to 192 kbps MP3."
          : mode === "exact"
            ? `Frame-accurate. Saves as ${clip.hasVideo ? "MP4" : "M4A"}, which plays everywhere; takes a while for long video.`
            : "Instant and lossless, but the start snaps to the nearest keyframe before it (usually under a second early)."}{" "}
        The trimmer (~30 MB) downloads the first time you use it.
      </p>

      <div className={st.actions}>
        <button className="btn-primary" disabled={!!busy} onClick={() => void trimAndDownload()}>
          Trim & save to computer
        </button>
        <button disabled={!!busy} onClick={() => void trimAndKeep()}>
          Trim & keep as new clip
        </button>
        {busyLabel && <span className={st.hint}>{busyLabel}</span>}
      </div>
    </div>
  );
}
