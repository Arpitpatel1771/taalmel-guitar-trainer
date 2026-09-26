// CodeMirror 6 editor for song text (UI revamp section 7). Controlled-ish:
// the parent owns the text; external value changes (e.g. after extraction)
// replace the document. Parse errors are passed in and shown as inline lint
// diagnostics; `jumpToLine` is exposed through a ref for the problems panel.

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import { EditorState } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { tags } from "@lezer/highlight";
import { autocompletion, closeBrackets, completionKeymap } from "@codemirror/autocomplete";
import { songCompletions } from "./songCompletions";
import type { ParseError } from "../../model";
import { songLanguage } from "./songLanguage";

export interface SongEditorHandle {
  jumpToLine: (line: number, column?: number) => void;
}

const highlight = HighlightStyle.define([
  { tag: tags.comment, color: "var(--text-muted)", fontStyle: "italic" },
  { tag: tags.heading, color: "var(--accent)", fontWeight: "600" },
  { tag: tags.keyword, color: "var(--info)", fontWeight: "600" },
  { tag: tags.propertyName, color: "var(--info)" },
  { tag: tags.labelName, color: "var(--text-muted)" },
  { tag: tags.typeName, color: "var(--text-muted)" },
  { tag: tags.string, color: "var(--text-primary)", fontWeight: "600" },
  { tag: tags.number, color: "var(--success)" },
  { tag: tags.operator, color: "var(--verdict-close)" },
  { tag: tags.invalid, color: "var(--warning)", fontWeight: "700" },
  { tag: tags.attributeName, color: "var(--verdict-missed)" },
  { tag: tags.attributeValue, color: "var(--text-secondary)" },
  { tag: [tags.bracket, tags.punctuation], color: "var(--text-muted)" },
]);

const theme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "var(--surface-0)",
      color: "var(--text-primary)",
      fontSize: "13px",
      border: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-md)",
    },
    "&.cm-focused": { outline: "none", borderColor: "var(--border-strong)" },
    // No ligatures: "->" or ">-" must show exactly as typed.
    ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.65", fontVariantLigatures: "none" },
    ".cm-content": { caretColor: "var(--accent)", padding: "8px 0" },
    ".cm-gutters": {
      backgroundColor: "var(--surface-1)",
      color: "var(--text-muted)",
      border: "none",
      borderRight: "1px solid var(--border-subtle)",
      borderRadius: "var(--radius-md) 0 0 var(--radius-md)",
    },
    ".cm-activeLine": { backgroundColor: "var(--accent-softer)" },
    ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--text-secondary)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "var(--accent-soft) !important" },
    ".cm-cursor": { borderLeftColor: "var(--accent)" },
    ".cm-tooltip": {
      backgroundColor: "var(--surface-3)",
      border: "1px solid var(--border-strong)",
      borderRadius: "var(--radius-sm)",
      color: "var(--text-primary)",
    },
    ".cm-tooltip-autocomplete > ul > li[aria-selected]": { backgroundColor: "var(--accent-soft)", color: "var(--text-primary)" },
    ".cm-completionDetail": { color: "var(--text-muted)", fontStyle: "normal", marginLeft: "8px" },
    ".cm-completionInfo": { maxWidth: "280px", padding: "6px 10px" },
    ".cm-diagnostic-error": { borderLeftColor: "var(--danger)" },
    ".cm-diagnostic-warning": { borderLeftColor: "var(--warning)" },
  },
  { dark: true },
);

function toDiagnostics(state: EditorState, errors: ParseError[]): Diagnostic[] {
  const doc = state.doc;
  return errors
    .filter((e) => e.line >= 1 && e.line <= doc.lines)
    .map((e) => {
      const line = doc.line(e.line);
      let from = line.from;
      let to = line.to;
      if (e.column && e.column >= 1) {
        from = Math.min(line.to, line.from + e.column - 1);
        const tokenLen = e.token ? e.token.length : 0;
        to = tokenLen > 0 ? Math.min(line.to, from + tokenLen) : line.to;
      }
      if (to <= from) to = Math.min(doc.length, from + 1);
      return {
        from,
        to,
        severity: e.severity === "warning" ? "warning" : "error",
        message: e.message,
        source: e.code,
      } satisfies Diagnostic;
    });
}

export const SongEditor = forwardRef<
  SongEditorHandle,
  { value: string; onChange: (text: string) => void; errors: ParseError[]; className?: string }
>(function SongEditor({ value, onChange, errors, className }, ref) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          lineNumbers(),
          history(),
          drawSelection(),
          highlightActiveLine(),
          lintGutter(),
          songLanguage,
          autocompletion({ override: [songCompletions], activateOnTyping: true }),
          closeBrackets(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => {
            if (u.docChanged) onChangeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // Created once; later `value` changes are synced below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External value changes (not from typing) replace the document.
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({ changes: { from: 0, to: current.length, insert: value } });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch(setDiagnostics(view.state, toDiagnostics(view.state, errors)));
  }, [errors]);

  useImperativeHandle(ref, () => ({
    jumpToLine(line: number, column?: number) {
      const view = viewRef.current;
      if (!view) return;
      const doc = view.state.doc;
      const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
      const pos = column ? Math.min(l.to, l.from + column - 1) : l.from;
      view.dispatch({ selection: { anchor: pos, head: column ? pos : l.to }, scrollIntoView: true });
      view.focus();
    },
  }));

  return <div ref={hostRef} className={className} />;
});
