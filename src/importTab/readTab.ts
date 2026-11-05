// Tab reader (spec 5-11-song-import.md section 3.1). Plain-text tab in, note events out.
// Pure functions, no DOM.

import type { StringNumber } from "../model/index.js";
import type {
  NoteEvent,
  ReadTabResult,
  SectionSuggestion,
  TabBar,
  TabError,
  TabNote,
  TabTechnique,
  Warning,
} from "./types.js";

const STANDARD = ["E", "B", "G", "D", "A", "E"]; // string 1..6
const MAX_FRET = 24;
const REPEAT_WARNING = "Repeats aren't expanded; copy the bars if needed";

// ---------------------------------------------------------------------------
// Line classification
// ---------------------------------------------------------------------------

interface StringLine {
  kind: "string";
  no: number;
  text: string;
  label?: string;
  contentStart: number;
  content: string;
  /** Text after the closing `|` (e.g. `x2`, `(let ring)`), when there is any. */
  trailing?: string;
  /** 1-based column of the trailing text. */
  trailingColumn?: number;
}
interface PmLine {
  kind: "pm";
  no: number;
  start: number; // absolute 0-based column where the covered span begins
  end: number; // absolute 0-based column of the last covered character
}
interface OtherLine {
  kind: "other";
  no: number;
  text: string;
}
type Line = StringLine | PmLine | OtherLine;

const CONTENT_RE = /^[-|0-9hpbrxsHPBRXS~/\\()^*.:\s]+$/;

function classify(raw: string, no: number): Line {
  const text = raw.replace(/\t/g, " ").replace(/\s+$/, "");

  const pm = /^(\s*)(P\.?M\.?)([\s|.-]*)$/.exec(text);
  if (pm && pm[3]!.includes("-")) {
    const start = pm[1]!.length;
    return { kind: "pm", no, start, end: text.length - 1 };
  }

  let label: string | undefined;
  let contentStart = 0;
  const m = /^(\s*)([A-Ga-g][#b]?|[1-6])(?:([|:])|\s+(?=[-|])|(?=-))/.exec(text);
  if (m) {
    const lbl = m[2]!;
    const isDigit = /^\d$/.test(lbl);
    const lookaheadOnly = m[3] === undefined && m[0]!.length === m[1]!.length + lbl.length;
    if (!(isDigit && lookaheadOnly)) {
      label = lbl;
      contentStart = m[3] === "|" ? m[0]!.length - 1 : m[0]!.length;
    }
  }
  let content = text.slice(contentStart);
  let trailing: string | undefined;
  let trailingColumn: number | undefined;
  const lastBar = content.lastIndexOf("|");
  if (lastBar > 0) {
    const rest = content.slice(lastBar + 1);
    const t = rest.trim();
    if (t && (/[A-Za-z]{2,}/.test(t) || /^(?:x\s?\d+|\d+\s?x)$/i.test(t))) {
      trailing = t;
      trailingColumn = contentStart + lastBar + 2 + (rest.length - rest.trimStart().length);
      content = content.slice(0, lastBar + 1);
    }
  }
  if (content.length >= 4 && CONTENT_RE.test(content) && (content.match(/-/g)?.length ?? 0) >= 3) {
    const line: StringLine = { kind: "string", no, text, label, contentStart, content };
    if (trailing !== undefined) {
      line.trailing = trailing;
      line.trailingColumn = trailingColumn;
    }
    return line;
  }
  return { kind: "other", no, text };
}

// ---------------------------------------------------------------------------
// Scanning one string line
// ---------------------------------------------------------------------------

interface RawNote {
  col: number; // content column
  abs: number; // 1-based column in the original line
  fret: number;
  technique: TabTechnique;
}

interface Ctx {
  warnings: Warning[];
  errors: TabError[];
  deadNotes: { count: number; line?: number };
}

const isDigit = (c: string | undefined): boolean => c !== undefined && c >= "0" && c <= "9";

function validBend(semitones: number): boolean {
  return semitones > 0 && semitones <= 4 && Number.isInteger(semitones * 2);
}

function scanLine(content: string, no: number, contentStart: number, ctx: Ctx): { notes: RawNote[]; barCols: number[] } {
  const notes: RawNote[] = [];
  const barCols: number[] = [];
  let prev: RawNote | null = null;
  let prevEnd = -1;
  let pendingOp: "hammer" | "pull" | "slide" | null = null;
  let pendingSlideIn = false;
  let pendingBend: RawNote | null = null;
  let pendingRelease: RawNote | null = null;

  const warn = (i: number, code: string, message: string) =>
    ctx.warnings.push({ line: no, column: contentStart + i + 1, code, message });
  const mk = (i: number, fret: number, technique: TabTechnique): RawNote => ({
    col: i,
    abs: contentStart + i + 1,
    fret,
    technique,
  });
  const emit = (n: RawNote, end: number) => {
    notes.push(n);
    prev = n;
    prevEnd = end;
  };
  const nextNonParen = (i: number): string | undefined => {
    let j = i + 1;
    while (content[j] === "(") j++;
    return content[j];
  };
  const clearPending = (i: number) => {
    if (pendingOp) warn(i, "TAB_DANGLING_TECHNIQUE", `Technique '${pendingOp}' has no note after it; ignored`);
    if (pendingBend) warn(i, "TAB_BEND_TARGET_MISSING", "Bend has no target fret; ignored");
    pendingOp = null;
    pendingSlideIn = false;
    pendingBend = null;
    pendingRelease = null;
  };

  let i = 0;
  while (i < content.length) {
    const c = content[i]!;

    if (c === "(" || c === ")") {
      if (prevEnd === i) prevEnd = i + 1;
      i++;
      continue;
    }
    if (c === "-" || c === " " || c === "*" || c === "." || c === ":") {
      if (pendingOp || pendingBend) clearPending(i);
      pendingRelease = null;
      pendingSlideIn = false;
      i++;
      continue;
    }
    if (c === "|") {
      if (pendingOp || pendingBend) clearPending(i);
      pendingRelease = null;
      pendingSlideIn = false;
      barCols.push(i);
      prev = null;
      prevEnd = -1;
      i++;
      continue;
    }

    if (isDigit(c)) {
      let j = i;
      while (isDigit(content[j])) j++;
      const text = content.slice(i, j);
      const fret = parseInt(text, 10);
      if (text.length > 2 || fret > MAX_FRET) {
        ctx.errors.push({
          line: no,
          column: contentStart + i + 1,
          code: "TAB_FRET_RANGE",
          message: `Line ${no}, column ${contentStart + i + 1}: fret ${text} is above ${MAX_FRET}`,
        });
        pendingOp = null;
        pendingSlideIn = false;
        pendingBend = null;
        pendingRelease = null;
        i = j;
        continue;
      }
      if (pendingBend) {
        const base: RawNote = pendingBend;
        pendingBend = null;
        const semis = fret - base.fret;
        if (validBend(semis)) {
          emit(mk(i, base.fret, { connection: { kind: "bend", semitones: semis } }), j);
        } else {
          warn(i, "TAB_BEND_RANGE", `Bend from ${base.fret} to ${fret} isn't 0.5 to 4 semitones; bend dropped`);
          prevEnd = j;
        }
      } else if (pendingRelease) {
        const base: RawNote = pendingRelease;
        pendingRelease = null;
        if (fret !== base.fret) {
          warn(i, "TAB_RELEASE_TARGET", `Release to fret ${fret} differs from the bent fret ${base.fret}; read as a release to ${base.fret}`);
        }
        emit(mk(i, base.fret, { connection: { kind: "bend", semitones: 0 } }), j);
      } else {
        const technique: TabTechnique = {};
        if (pendingOp) technique.connection = { kind: pendingOp };
        else if (pendingSlideIn) technique.slideIn = true;
        pendingOp = null;
        pendingSlideIn = false;
        emit(mk(i, fret, technique), j);
      }
      i = j;
      continue;
    }

    const adjacent = prev !== null && prevEnd === i;
    const lc = c.toLowerCase();

    if (lc === "h" || lc === "p") {
      if (adjacent && isDigit(nextNonParen(i))) {
        pendingOp = lc === "h" ? "hammer" : "pull";
        prevEnd = i + 1;
      } else {
        warn(i, "TAB_DANGLING_TECHNIQUE", `'${c}' needs a note on each side; ignored`);
      }
      i++;
      continue;
    }
    if (c === "/" || c === "\\" || lc === "s") {
      const nextIsDigit = isDigit(nextNonParen(i));
      if (adjacent && nextIsDigit) {
        pendingOp = "slide";
        prevEnd = i + 1;
      } else if (adjacent) {
        prev!.technique.slideOut = true;
        prevEnd = i + 1;
      } else if (nextIsDigit) {
        pendingSlideIn = true;
      }
      i++;
      continue;
    }
    if (lc === "b" || c === "^") {
      if (!adjacent) {
        warn(i, "TAB_DANGLING_TECHNIQUE", "Bend with no note before it; ignored");
      } else if (isDigit(nextNonParen(i))) {
        pendingBend = prev;
        prevEnd = i + 1;
      } else {
        warn(i, "TAB_BEND_TARGET_MISSING", "Bend has no target fret; read as a whole-step (2 semitones) bend");
        emit(mk(i, prev!.fret, { connection: { kind: "bend", semitones: 2 } }), i + 1);
      }
      i++;
      continue;
    }
    if (lc === "r") {
      if (!adjacent) {
        warn(i, "TAB_DANGLING_TECHNIQUE", "Release with no note before it; ignored");
      } else if (isDigit(nextNonParen(i))) {
        pendingRelease = prev;
        prevEnd = i + 1;
      } else {
        emit(mk(i, prev!.fret, { connection: { kind: "bend", semitones: 0 } }), i + 1);
      }
      i++;
      continue;
    }
    if (c === "~") {
      if (adjacent) {
        prev!.technique.vibrato = true;
        prevEnd = i + 1;
      }
      i++;
      continue;
    }
    if (lc === "x") {
      const before = content[i - 1];
      if (adjacent && (isDigit(before) || before === "~")) {
        prev!.technique.muted = true;
        prevEnd = i + 1;
      } else {
        ctx.deadNotes.count++;
        ctx.deadNotes.line ??= no;
        emit(mk(i, 0, { muted: true }), i + 1);
      }
      i++;
      continue;
    }
    i++;
  }
  if (pendingOp || pendingBend) clearPending(content.length);
  return { notes, barCols };
}

// ---------------------------------------------------------------------------
// Noise lines
// ---------------------------------------------------------------------------

const REPEAT_RE = /(?:\bx\s?\d+\b|\b\d+\s?x\b|\brepeats?\b|\btwice\b|\b\d+\s*times\b)/i;
const HEADING_RE =
  /^[[(]?\s*(?:intro|verse|chorus|pre[- ]?chorus|bridge|solo|outro|interlude|refrain|riff|lead|rhythm|break|hook|coda|ending|instrumental|breakdown|main riff|tag|turnaround)(?:\s*(?:\d+|[ivx]+|[a-d]))?\s*[\])]?\s*[:.-]?\s*(?:\(.*\))?\s*$/i;
const SIX_NOTES_RE = /^(?:tuning\s*[:=-]?\s*)?([A-Ga-g][#b]?)(?:[\s,-]+([A-Ga-g][#b]?)){5}\s*$/i;

function cleanHeading(s: string): string {
  let name = s
    .replace(/^[[(]\s*/, "")
    .replace(/\s*[\])]\s*$/, "")
    .replace(/\s*[:.-]\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (name === name.toUpperCase()) name = name.charAt(0) + name.slice(1).toLowerCase();
  return name.replace(/]/g, "");
}

function normNote(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function tuningWarning(label: string, no: number): Warning {
  return {
    line: no,
    code: "TAB_TUNING_NONSTANDARD",
    message: `Line ${no}: non-standard tuning (${label}). Only standard tuning (E A D G B E) is supported for now; notes are read as if in standard tuning.`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export function readTab(text: string): ReadTabResult {
  const rawLines = text.split(/\r?\n/);
  const lines: Line[] = rawLines.map((l, i) => classify(l, i + 1));

  const warnings: Warning[] = [];
  const errors: TabError[] = [];
  const events: NoteEvent[] = [];
  const bars: TabBar[] = [];
  const sectionNames: SectionSuggestion[] = [];
  const deadNotes = { count: 0, line: undefined as number | undefined };
  const ctx: Ctx = { warnings, errors, deadNotes };
  let capo: number | undefined;
  let blockCount = 0;
  let sawBlock = false;
  let tuningWarned = false;
  const warnTuning = (label: string, no: number) => {
    if (tuningWarned) return;
    tuningWarned = true;
    warnings.push(tuningWarning(label, no));
  };
  /** Last fret per string while validating connection flags, across blocks. */

  const handleNoise = (l: OtherLine) => {
    const t = l.text.trim();
    if (!t) return;

    // capo
    if (/\bcapo\b/i.test(t) && !/\b(no|without)\s+capo\b/i.test(t)) {
      const cm = /capo\D{0,15}?(\d{1,2})/i.exec(t);
      if (cm) {
        const n = parseInt(cm[1]!, 10);
        if (n >= 0 && n <= 12) {
          if (capo !== undefined && capo !== n) {
            warnings.push({ line: l.no, code: "TAB_CAPO_CONFLICT", message: `Line ${l.no}: a second capo line (${n}) was ignored; using capo ${capo}` });
          } else if (capo === undefined) {
            capo = n;
          }
        } else {
          warnings.push({ line: l.no, code: "TAB_CAPO_RANGE", message: `Line ${l.no}: capo ${n} is outside 0-12; ignored` });
        }
        return;
      }
    }

    // tuning
    const six = SIX_NOTES_RE.exec(t);
    const hasTuningWord = /\btuning\b|\btuned\b/i.test(t);
    if ((six && (hasTuningWord || !sawBlock)) || hasTuningWord || /\bdrop\s?[A-G]\b|\bdadgad\b|\bopen\s+[A-G]\b|half[- ]?step|whole[- ]?step|step down/i.test(t)) {
      if (/\bstandard\b/i.test(t)) return;
      if (six) {
        const notes = t.replace(/^tuning\s*[:=-]?\s*/i, "").split(/[\s,-]+/).map(normNote);
        const low = notes.join(" ");
        const std = [...STANDARD].reverse().join(" "); // low to high: E A D G B E
        const rev = STANDARD.join(" ");
        if (low !== std && low !== rev) warnTuning(low, l.no);
        return;
      }
      warnTuning(t, l.no);
      return;
    }

    // repeats
    let rest = t;
    if (REPEAT_RE.test(t)) {
      warnings.push({ line: l.no, code: "TAB_REPEAT", message: REPEAT_WARNING });
      rest = t.replace(/\(?\s*x\s?\d+\s*\)?|\b\d+\s?x\b|\brepeats?\b|\btwice\b|\b\d+\s*times\b/gi, "").trim();
      if (!rest) return;
    }

    // headings
    const bracket = /^\[([^\]]{1,40})\]$/.exec(rest);
    if (bracket) {
      sectionNames.push({ name: cleanHeading(bracket[1]!), barIndex: bars.length, line: l.no });
    } else if (HEADING_RE.test(rest)) {
      sectionNames.push({ name: cleanHeading(rest), barIndex: bars.length, line: l.no });
    }
  };

  const processBlock = (chunk: StringLine[], pm: PmLine | null) => {
    const block = blockCount++;
    sawBlock = true;
    const top = chunk[0]!;

    // Text after the closing bar line (repeat marks, performance notes).
    const seenTrailing = new Set<string>();
    for (const l of chunk) {
      if (l.trailing === undefined || seenTrailing.has(l.trailing)) continue;
      seenTrailing.add(l.trailing);
      if (REPEAT_RE.test(l.trailing)) {
        warnings.push({ line: l.no, column: l.trailingColumn, code: "TAB_REPEAT", message: REPEAT_WARNING });
      } else {
        warnings.push({
          line: l.no,
          column: l.trailingColumn,
          code: "TAB_TRAILING_TEXT",
          message: `Line ${l.no}: text after the bar line ("${l.trailing}") was ignored`,
        });
      }
    }

    // Equal content lengths.
    const lens = chunk.map((l) => l.content.length);
    const counts = new Map<number, number>();
    for (const n of lens) counts.set(n, (counts.get(n) ?? 0) + 1);
    let modeLen = lens[0]!;
    let best = 0;
    for (const [len, c] of counts) {
      if (c > best) {
        best = c;
        modeLen = len;
      }
    }
    const badIdx = lens.findIndex((n) => n !== modeLen);
    if (badIdx >= 0) {
      const bad = chunk[badIdx]!;
      errors.push({
        line: bad.no,
        column: bad.text.length + 1,
        code: "TAB_LINE_LENGTH",
        message: `Line ${bad.no}: string lines have different lengths (${lens[badIdx]} characters here, ${modeLen} on the others)`,
      });
      return;
    }
    const length = modeLen;

    // String order.
    const labels = chunk.map((l) => l.label);
    let stringOf: StringNumber[] = [1, 2, 3, 4, 5, 6];
    if (labels.every((l) => l !== undefined)) {
      const ls = labels as string[];
      if (ls.every((l) => /^[1-6]$/.test(l)) && new Set(ls).size === 6) {
        stringOf = ls.map((l) => Number(l) as StringNumber);
      } else if (ls.every((l) => /^[A-Ga-g]/.test(l))) {
        const norm = ls.map(normNote);
        const scoreN = norm.filter((n, i) => n === STANDARD[i]).length;
        const scoreR = norm.filter((n, i) => n === STANDARD[5 - i]).length;
        const reversed =
          scoreR > scoreN ||
          (scoreR === scoreN && ls[0] === "E" && ls[5] === "e");
        stringOf = chunk.map((_, i) => (reversed ? 6 - i : i + 1) as StringNumber);
        const labelOfString: string[] = [];
        norm.forEach((n, i) => (labelOfString[stringOf[i]! - 1] = n));
        if (labelOfString.some((n, s) => n !== STANDARD[s])) {
          warnTuning([...labelOfString].reverse().join(" "), top.no);
        }
      }
    }

    // Scan lines.
    const allBarCols = new Set<number>();
    const raw: { string: StringNumber; note: RawNote }[] = [];
    chunk.forEach((l, i) => {
      const r = scanLine(l.content, l.no, l.contentStart, ctx);
      r.barCols.forEach((c) => allBarCols.add(c));
      for (const note of r.notes) raw.push({ string: stringOf[i]!, note });
    });

    // Palm mute.
    if (pm) {
      const rel0 = top.contentStart;
      let hit = 0;
      for (const r of raw) {
        const abs = r.note.col + rel0;
        if (abs >= pm.start && abs <= pm.end) {
          r.note.technique.muted = true;
          hit++;
        }
      }
      if (hit === 0) {
        warnings.push({ line: pm.no, code: "TAB_PM_EMPTY", message: `Line ${pm.no}: palm-mute (PM) line covers no notes` });
      }
    }

    // Bar spans.
    const cols = [...allBarCols].sort((a, b) => a - b);
    const merged: number[] = [];
    for (const c of cols) if (merged.length === 0 || c - merged[merged.length - 1]! > 1) merged.push(c);
    const explicit = merged.length > 0;
    const noteCols = new Set(raw.map((r) => r.note.col));
    const hasNoteIn = (s: number, e: number) => [...noteCols].some((c) => c >= s && c < e);
    const spans: [number, number][] = [];
    let prevEdge = -1;
    for (const b of merged) {
      if (b > prevEdge + 1) spans.push([prevEdge + 1, b]);
      prevEdge = b;
    }
    if (length > prevEdge + 1) spans.push([prevEdge + 1, length]);
    const keptSpans = explicit
      ? spans.filter(([s, e], idx) => {
          const edge = idx === 0 || idx === spans.length - 1;
          return !edge || hasNoteIn(s, e) || (spans.length === 1);
        })
      : [[0, length] as [number, number]];
    const firstBar = bars.length;
    for (const [s, e] of keptSpans) {
      bars.push({ index: bars.length, block, startColumn: s, endColumn: e, explicit });
    }

    // Events.
    const byCol = new Map<number, NoteEvent>();
    for (const r of raw.sort((a, b) => a.note.col - b.note.col || a.string - b.string)) {
      const barIdx = keptSpans.findIndex(([s, e]) => r.note.col >= s && r.note.col < e);
      if (barIdx < 0) {
        warnings.push({ line: top.no, column: r.note.abs, code: "TAB_NOTE_OUTSIDE_BAR", message: `Line ${top.no}: a note outside any bar was ignored` });
        continue;
      }
      let ev = byCol.get(r.note.col);
      if (!ev) {
        ev = { column: r.note.col, bar: firstBar + barIdx, block, blockLine: top.no, notes: [] };
        byCol.set(r.note.col, ev);
        events.push(ev);
      }
      if (ev.notes.some((n) => n.string === r.string)) {
        warnings.push({ line: top.no, column: r.note.abs, code: "TAB_DUPLICATE_NOTE", message: `Line ${top.no}: two notes on string ${r.string} in one column; the second was ignored` });
        continue;
      }
      const tn: TabNote = { string: r.string, fret: r.note.fret };
      if (Object.keys(r.note.technique).length > 0) tn.technique = r.note.technique;
      ev.notes.push(tn);
    }
  };

  // Walk the lines in order.
  let pendingPm: PmLine | null = null;
  let idx = 0;
  while (idx < lines.length) {
    const l = lines[idx]!;
    if (l.kind === "pm") {
      pendingPm = l;
      idx++;
      continue;
    }
    if (l.kind === "string") {
      const run: StringLine[] = [];
      while (idx < lines.length && lines[idx]!.kind === "string") run.push(lines[idx++] as StringLine);
      if (run.length % 6 !== 0) {
        errors.push({
          line: run[0]!.no,
          code: "TAB_BLOCK_SIZE",
          message: `Line ${run[0]!.no}: found ${run.length} string lines in a row; a tab block needs 6`,
        });
      } else {
        for (let k = 0; k < run.length; k += 6) {
          processBlock(run.slice(k, k + 6), k === 0 ? pendingPm : null);
        }
      }
      pendingPm = null;
      continue;
    }
    pendingPm = null;
    handleNoise(l);
    idx++;
  }

  if (deadNotes.count > 0) {
    warnings.push({
      line: deadNotes.line,
      code: "TAB_DEAD_NOTE",
      message: `${deadNotes.count} dead note(s) (x) were read as muted open strings; check the fret`,
    });
  }

  // Order events, then fix up connection flags against the format's rules.
  events.sort((a, b) => (a.block ?? 0) - (b.block ?? 0) || a.column - b.column);
  const lastFret = new Map<number, number>();
  for (const ev of events) {
    for (const n of ev.notes) {
      const conn = n.technique?.connection;
      const prevFret = lastFret.get(n.string);
      if (conn?.kind === "pull" && (prevFret === undefined || n.fret >= prevFret)) {
        delete n.technique!.connection;
        warnings.push({
          line: ev.blockLine,
          code: "TAB_PULL_NOT_LOWER",
          message: `Line ${ev.blockLine}: pull-off to fret ${n.fret} on string ${n.string} needs a lower fret than the note before it${prevFret === undefined ? " (there is none)" : ` (${prevFret})`}; the pull-off flag was dropped`,
        });
      } else if (conn?.kind === "slide") {
        if (prevFret === undefined) {
          delete n.technique!.connection;
          n.technique!.slideIn = true;
        } else if (prevFret === n.fret) {
          delete n.technique!.connection;
          warnings.push({
            line: ev.blockLine,
            code: "TAB_SLIDE_SAME_FRET",
            message: `Line ${ev.blockLine}: slide on string ${n.string} stays on fret ${n.fret}; the slide flag was dropped`,
          });
        }
      }
      if (n.technique && Object.keys(n.technique).length === 0) delete n.technique;
      lastFret.set(n.string, n.fret);
    }
  }

  // Section suggestions only make sense if a bar follows them.
  const names = sectionNames.filter((s, i) => s.barIndex < bars.length && sectionNames.findIndex((o) => o.barIndex === s.barIndex) === i);

  if (events.length === 0 && errors.length === 0) {
    errors.push({ line: 1, code: "TAB_NOT_FOUND", message: "No tab found: expected blocks of 6 string lines like e|--3--5--|" });
  }

  const result: ReadTabResult = { events, bars, sectionNames: names, warnings, errors };
  if (capo !== undefined) result.capo = capo;
  return result;
}
