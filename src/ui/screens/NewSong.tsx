// "New song from notes" import flow (spec 11.1-11.3).
import { useShell } from "../shell/AppShellContext";

import { Fragment, useMemo, useRef, useState } from "react";
import type { ParseError, Settings, TimeSignature } from "../../model";
import { buildImportPrompt, buildRepairPrompt, extractSong, parse, parseYouTubeId, serialize } from "../../songFormat";
import { computeLayout } from "../../layout";
import { Sheet, buildSongIndex } from "../../render";
import { SongEditor, type SongEditorHandle } from "../editor/SongEditor";
import { ProblemsPanel } from "../editor/ProblemsPanel";
import { SyntaxReference } from "../editor/SyntaxReference";
import ed from "../editor/Editor.module.css";
import { ArrowLeft, ArrowRight, Check, Copy } from "lucide-react";
import { copyToClipboard, useDebouncedValue } from "../utils";
import { useElementWidth } from "../useElementWidth";

export interface NewSongProps {
  settings: Settings;
  onSaveSong: (text: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  onSaved: (id: string) => void;
  onCancel: () => void;
}

type Stage = "form" | "compose" | "review";

function parseTimeSig(value: string): TimeSignature | null {
  const m = /^(\d+)\s*\/\s*(\d+)$/.exec(value.trim());
  if (!m) return null;
  return { numerator: Number(m[1]), denominator: Number(m[2]) };
}


export function NewSong({ settings, onSaveSong, onSaved, onCancel }: NewSongProps) {
  const [stage, setStage] = useState<Stage>("form");

  const [title, setTitle] = useState("");
  const [timeStr, setTimeStr] = useState("4/4");
  const [bpm, setBpm] = useState(100);
  const [unit, setUnit] = useState(8);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [offsetSec, setOffsetSec] = useState(0);
  const [formError, setFormError] = useState<string | null>(null);

  const [prompt, setPrompt] = useState("");
  const [reply, setReply] = useState("");
  const [extractError, setExtractError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const debouncedText = useDebouncedValue(text, 300);
  const { toast } = useShell();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const editorRef = useRef<SongEditorHandle | null>(null);

  const parseResult = useMemo(() => parse(debouncedText), [debouncedText]);
  const errors: ParseError[] = parseResult.ok
    ? parseResult.warnings
    : [...parseResult.errors, ...parseResult.warnings];

  const [previewWidthRef, previewWidth] = useElementWidth(700);
  const previewLanes = { ...settings.lanes, letter: true };
  const layout = useMemo(() => {
    if (!parseResult.ok) return null;
    return computeLayout(parseResult.song, { viewportWidth: previewWidth, zoom: settings.zoom, lanes: previewLanes });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parseResult, previewWidth, settings.zoom]);
  const songIndex = useMemo(() => (parseResult.ok ? buildSongIndex(parseResult.song) : null), [parseResult]);

  function generatePrompt() {
    const time = parseTimeSig(timeStr);
    if (!title.trim()) {
      setFormError("Title is required.");
      return;
    }
    if (!time) {
      setFormError("Time signature must look like 4/4.");
      return;
    }
    if (!(bpm > 0 && bpm <= 400)) {
      setFormError("BPM must be between 1 and 400.");
      return;
    }
    if (!(unit >= 1)) {
      setFormError("Grid unit must be at least 1.");
      return;
    }
    let videoId: string | null = null;
    if (youtubeUrl.trim()) {
      videoId = parseYouTubeId(youtubeUrl.trim());
      if (!videoId) {
        setFormError("That doesn't look like a valid YouTube URL.");
        return;
      }
    }
    setFormError(null);
    const builtPrompt = buildImportPrompt({
      title: title.trim(),
      time,
      bpm,
      unit,
      youtubeUrl: youtubeUrl.trim() || undefined,
      offsetSec: youtubeUrl.trim() ? offsetSec : undefined,
    });
    setPrompt(builtPrompt);
    setStage("compose");
  }

  function extract() {
    const result = extractSong(reply);
    if (!result.ok) {
      setExtractError(result.message);
      return;
    }
    setExtractError(null);
    setText(result.text);
    setStage("review");
  }

  function jumpToLine(line: number, column?: number) {
    editorRef.current?.jumpToLine(line, column);
  }

  async function doCopy(label: string, value: string) {
    const ok = await copyToClipboard(value);
    toast(ok ? `${label} copied.` : `Could not copy ${label.toLowerCase()}: copy it manually.`, ok ? "success" : "error");
  }

  async function handleSave() {
    if (!parseResult.ok) return;
    setSaving(true);
    setSaveError(null);
    const canonical = serialize(parseResult.song);
    const result = await onSaveSong(canonical);
    setSaving(false);
    if (result.ok) onSaved(result.id);
    else setSaveError(result.message);
  }

  const steps: { id: Stage; label: string }[] = [
    { id: "form", label: "Details" },
    { id: "compose", label: "Ask your LLM" },
    { id: "review", label: "Paste & fix" },
  ];
  const stageIndex = steps.findIndex((st) => st.id === stage);
  const blockingErrors = errors.filter((e) => e.severity !== "warning");

  return (
    <div className="screen new-song-screen">
      <div className="screen-header">
        <h2>New song from notes</h2>
        <div className={ed.stepper} aria-label="Progress">
          {steps.map((st, i) => (
            <Fragment key={st.id}>
              {i > 0 && <span className={ed.stepLine} />}
              <span className={`${ed.step}${i === stageIndex ? ` ${ed.stepActive}` : i < stageIndex ? ` ${ed.stepDone}` : ""}`}>
                <span className={ed.stepNum}>{i < stageIndex ? <Check size={12} /> : i + 1}</span>
                {st.label}
              </span>
            </Fragment>
          ))}
        </div>
        <button className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
      </div>

      {stage === "form" && (
        <div className={ed.card}>
          <div className={ed.cardTitle}>Song details</div>
          <p className={ed.hint}>These go into the prompt as-is; the LLM only transcribes the notes.</p>
          <div className={ed.fields}>
            <label className={`${ed.field} ${ed.fieldWide}`}>
              Title
              <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Tum Hi Ho" autoFocus />
            </label>
            <label className={ed.field}>
              Time signature
              <input value={timeStr} onChange={(e) => setTimeStr(e.target.value)} placeholder="4/4" />
            </label>
            <label className={ed.field}>
              BPM
              <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
            </label>
            <label className={ed.field}>
              Grid (slots per bar)
              <input type="number" value={unit} onChange={(e) => setUnit(Number(e.target.value))} />
            </label>
            <label className={`${ed.field} ${ed.fieldWide}`}>
              YouTube link (optional)
              <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtu.be/…" />
            </label>
            {youtubeUrl.trim() && (
              <label className={ed.field}>
                Bar 1 starts at (seconds)
                <input type="number" value={offsetSec} onChange={(e) => setOffsetSec(Number(e.target.value))} />
              </label>
            )}
          </div>
          {formError && <div className="notice notice-error">{formError}</div>}
          <div className={ed.actions}>
            <button className={`btn-primary ${ed.actionsEnd}`} onClick={generatePrompt}>
              Next: build prompt <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {stage === "compose" && (
        <div className={ed.card}>
          <div className={ed.cardTitle}>1. Copy the prompt</div>
          <p className={ed.hint}>Paste it into any LLM together with a photo or transcription of the notes.</p>
          <pre className={ed.codeBlock}>{prompt}</pre>
          <div className={ed.actions}>
            <button className="btn-primary" onClick={() => void doCopy("Prompt", prompt)}>
              <Copy size={15} /> Copy prompt
            </button>
          </div>
          <div className={ed.cardTitle}>2. Paste the LLM's reply</div>
          <textarea
            className={ed.replyBox}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            placeholder="Paste the whole reply, including the ```song block"
            spellCheck={false}
          />
          {extractError && <div className="notice notice-error">{extractError}</div>}
          <div className={ed.actions}>
            <button className="btn-ghost" onClick={() => setStage("form")}>
              <ArrowLeft size={15} /> Back
            </button>
            <button className={`btn-primary ${ed.actionsEnd}`} onClick={extract} disabled={!reply.trim()}>
              Next: check song <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {stage === "review" && (
        <div className={ed.split}>
          <div className={ed.pane}>
            <SongEditor ref={editorRef} value={text} onChange={setText} errors={errors} className={ed.editorHost} />
            <ProblemsPanel
              errors={errors}
              onJump={jumpToLine}
              actions={
                blockingErrors.length > 0 ? (
                  <button onClick={() => void doCopy("Repair prompt", buildRepairPrompt(blockingErrors, text))}>
                    <Copy size={14} /> Copy repair prompt
                  </button>
                ) : null
              }
            />
            <SyntaxReference />
            {saveError && <div className="notice notice-error">Could not save: {saveError}</div>}
            <div className={ed.actions}>
              <button className="btn-ghost" onClick={() => setStage("compose")}>
                <ArrowLeft size={15} /> Back to reply
              </button>
              <button className={`btn-primary ${ed.actionsEnd}`} disabled={!parseResult.ok || saving} onClick={() => void handleSave()}>
                {saving ? "Saving…" : "Save song"}
              </button>
            </div>
          </div>
          <div className={ed.pane}>
            {parseResult.ok && layout && songIndex ? (
              <div className={ed.preview} ref={previewWidthRef}>
                <Sheet song={parseResult.song} layout={layout} songIndex={songIndex} lanes={previewLanes} onReady={() => {}} />
              </div>
            ) : (
              <div className={ed.previewEmpty} ref={previewWidthRef}>
                Fix the errors to see the preview
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
