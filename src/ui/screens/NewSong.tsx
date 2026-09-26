// "New song from notes" import flow (spec 11.1-11.3).
import { useShell } from "../shell/AppShellContext";

import { useMemo, useRef, useState } from "react";
import type { ParseError, Settings, TimeSignature } from "../../model";
import { buildImportPrompt, buildRepairPrompt, extractSong, parse, parseYouTubeId, serialize } from "../../songFormat";
import { computeLayout } from "../../layout";
import { Sheet, buildSongIndex } from "../../render";
import { ErrorList } from "../components/ErrorList";
import { offsetOfLine, useDebouncedValue } from "../utils";
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

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

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

  function jumpToLine(line: number) {
    const ta = textareaRef.current;
    if (!ta) return;
    const offset = offsetOfLine(text, line);
    ta.focus();
    ta.setSelectionRange(offset, offset + (text.slice(offset).split("\n")[0]?.length ?? 0));
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

  return (
    <div className="screen new-song-screen">
      <div className="screen-header">
        <h2>New song from notes</h2>
        <button onClick={onCancel}>Cancel</button>
      </div>


      {stage === "form" && (
        <div className="new-song-form">
          <label>
            Title
            <input value={title} onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label>
            Time signature
            <input value={timeStr} onChange={(e) => setTimeStr(e.target.value)} placeholder="4/4" />
          </label>
          <label>
            BPM
            <input type="number" value={bpm} onChange={(e) => setBpm(Number(e.target.value))} />
          </label>
          <label>
            Grid unit (slots per bar)
            <input type="number" value={unit} onChange={(e) => setUnit(Number(e.target.value))} />
          </label>
          <label>
            YouTube URL (optional)
            <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtu.be/..." />
          </label>
          {youtubeUrl.trim() && (
            <label>
              Offset (seconds at bar 1)
              <input type="number" value={offsetSec} onChange={(e) => setOffsetSec(Number(e.target.value))} />
            </label>
          )}
          {formError && <div className="notice notice-error">{formError}</div>}
          <button className="btn-primary" onClick={generatePrompt}>
            Generate import prompt
          </button>
        </div>
      )}

      {stage === "compose" && (
        <div className="new-song-compose">
          <section>
            <h3>1. Copy this prompt to your LLM (with a photo/transcription of the notes)</h3>
            <textarea className="prompt-box" readOnly value={prompt} rows={10} />
            <button onClick={() => void doCopy("Prompt", prompt)}>Copy prompt</button>
          </section>
          <section>
            <h3>2. Paste the LLM's reply here</h3>
            <textarea
              className="reply-box"
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={10}
              placeholder="Paste the full reply, including the ```song block"
            />
            {extractError && <div className="notice notice-error">{extractError}</div>}
            <button className="btn-primary" onClick={extract}>
              Extract song
            </button>
          </section>
          <button onClick={() => setStage("form")}>Back to form</button>
        </div>
      )}

      {stage === "review" && (
        <div className="new-song-review">
          <div className="editor-pane">
            <textarea
              ref={textareaRef}
              className="song-editor"
              value={text}
              onChange={(e) => setText(e.target.value)}
              spellCheck={false}
            />
            <div className="editor-side">
              <button className="btn-primary" disabled={!parseResult.ok || saving} onClick={() => void handleSave()}>
                {saving ? "Saving…" : "Save"}
              </button>
              <button onClick={() => void doCopy("Repair prompt", buildRepairPrompt(errors.filter((e) => e.severity !== "warning"), text))} disabled={parseResult.ok}>
                Copy repair prompt
              </button>
              <button onClick={() => setStage("compose")}>Back to reply</button>
              {saveError && <div className="notice notice-error">Could not save: {saveError}</div>}
              <ErrorList errors={errors} onJump={jumpToLine} />
            </div>
          </div>
          {parseResult.ok && layout && songIndex && (
            <div className="editor-preview" ref={previewWidthRef}>
              <Sheet
                song={parseResult.song}
                layout={layout}
                songIndex={songIndex}
                lanes={previewLanes}
                onReady={() => {}}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
