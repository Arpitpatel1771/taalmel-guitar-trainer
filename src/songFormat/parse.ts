// Parser for the song text format (spec section 5). Produces a `Song` or `ParseError[]`.
//
// Validation is staged per spec 5.8: syntax -> structure -> semantics, collecting all
// errors within a stage before stopping at that stage. See errorCodes.ts for which
// code belongs to which stage.

import type {
  Bar,
  ConnectionKind,
  Note,
  NoteMeta,
  ParseError,
  ParseResult,
  Section,
  Song,
  SongHeader,
  StringNumber,
  TimeSignature,
} from "../model/index.js";
import { WHOLE_NOTE_TICKS } from "../model/index.js";
import { pitchOf } from "../notation/index.js";
import { mkError, mkWarning } from "./errors.js";
import { parseYouTubeId } from "./youtube.js";

const KNOWN_HEADER_KEYS = ["title", "time", "bpm", "unit", "youtube", "offset"] as const;
const VALID_DENOMINATORS = [1, 2, 4, 8, 16, 32];
const KNOWN_META_KEYS = new Set([
  "hammer",
  "pull",
  "slide",
  "bend",
  "slide_in",
  "slide_out",
  "vibrato",
  "muted",
  "strum",
  "flat",
]);
const CONNECTION_KEYS = new Set(["hammer", "pull", "slide", "bend"]);
// Pitch classes (0=C) that are natural (white-key) notes. `flat` only makes sense
// on a black-key fret, so it is rejected on any of these (spec 5.6).
const NATURAL_PITCH_CLASSES = new Set([0, 2, 4, 5, 7, 9, 11]);

// ---------------------------------------------------------------------------
// Raw (grammar-level) intermediate structures, built during the syntax stage.
// ---------------------------------------------------------------------------

interface RawLength {
  raw: string;
  kind: "none" | "units" | "fraction";
  k?: number;
  a?: number;
  b?: number;
  offsetMs?: number;
  uncertain: boolean;
}

interface RawMetaEntry {
  key: string;
  value?: string;
  line: number;
}

interface RawNote {
  stringNum: number;
  fret: number;
  length: RawLength | null;
  meta: RawMetaEntry[];
  token: string;
  line: number;
  column: number;
}

interface RawSlotGroup {
  slot: number;
  slotToken: string;
  line: number;
  column: number;
  notes: RawNote[];
}

interface RawBar {
  barNumber: number;
  nOverride: number | null;
  line: number;
  slotGroups: RawSlotGroup[];
}

interface RawHeaderField {
  key: string;
  value: string;
  line: number;
}

interface RawSection {
  name: string;
  nameLine: number;
  fields: RawHeaderField[];
  bars: RawBar[];
}

// ---------------------------------------------------------------------------
// Tokenizing helpers
// ---------------------------------------------------------------------------

/** Splits `s` on whitespace, returning each token with its 1-based column in the
 * original line (s is assumed to start at column `baseCol` of that line).
 * Whitespace inside `[...]` or `(...)` (e.g. `(bend: 2, vibrato)`) does not split
 * a token, since the metadata/length grammar allows spaces around `,` and `:`. */
function scanTokens(s: string, baseCol: number): { text: string; col: number }[] {
  const out: { text: string; col: number }[] = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i]!)) i++;
    if (i >= s.length) break;
    let j = i;
    let depth = 0;
    while (j < s.length && (depth > 0 || !/\s/.test(s[j]!))) {
      if (s[j] === "[" || s[j] === "(") depth++;
      else if (s[j] === "]" || s[j] === ")") depth = Math.max(0, depth - 1);
      j++;
    }
    out.push({ text: s.slice(i, j), col: baseCol + i });
    i = j;
  }
  return out;
}

function parseLengthContent(content: string): RawLength | null {
  if (content === "") return null;
  let rest = content;
  let kind: RawLength["kind"] = "none";
  let k: number | undefined;
  let a: number | undefined;
  let b: number | undefined;

  const countMatch = /^(\d+)(?:X(\d+)\/(\d+))?/.exec(rest);
  if (countMatch) {
    rest = rest.slice(countMatch[0].length);
    k = parseInt(countMatch[1]!, 10);
    if (countMatch[2] !== undefined) {
      kind = "fraction";
      a = parseInt(countMatch[2]!, 10);
      b = parseInt(countMatch[3]!, 10);
    } else {
      kind = "units";
    }
  }

  let offsetMs: number | undefined;
  const offsetMatch = /^>([+-]?\d+)/.exec(rest);
  if (offsetMatch) {
    rest = rest.slice(offsetMatch[0].length);
    offsetMs = parseInt(offsetMatch[1]!, 10);
  }

  let uncertain = false;
  if (rest.startsWith("?")) {
    uncertain = true;
    rest = rest.slice(1);
  }

  if (rest.length > 0) return null;
  return { raw: content, kind, k, a, b, offsetMs, uncertain };
}

function parseNoteToken(
  tok: string,
  line: number,
  col: number,
  errors: ParseError[],
): RawNote | null {
  const m = /^(\d+)S(\d+)(\[[^\]]*\])?(\([^)]*\))?$/.exec(tok);
  if (!m) {
    errors.push(
      mkError(line, "MALFORMED_NOTE_TOKEN", `Malformed note token '${tok}'`, {
        column: col,
        token: tok,
      }),
    );
    return null;
  }
  const stringNum = parseInt(m[1]!, 10);
  const fret = parseInt(m[2]!, 10);

  let length: RawLength | null = null;
  if (m[3] !== undefined) {
    const parsed = parseLengthContent(m[3].slice(1, -1));
    if (!parsed) {
      errors.push(
        mkError(line, "MALFORMED_NOTE_TOKEN", `Malformed length block in '${tok}'`, {
          column: col,
          token: tok,
        }),
      );
      return null;
    }
    length = parsed;
  }

  const meta: RawMetaEntry[] = [];
  if (m[4] !== undefined) {
    const content = m[4].slice(1, -1);
    if (content.length === 0) {
      errors.push(
        mkError(line, "MALFORMED_METADATA", `Empty metadata block in '${tok}'`, {
          column: col,
          token: tok,
        }),
      );
      return null;
    }
    for (const part of content.split(",")) {
      const entryMatch = /^\s*([A-Za-z_]+)\s*(?::\s*(.*?)\s*)?$/.exec(part);
      if (!entryMatch) {
        errors.push(
          mkError(line, "MALFORMED_METADATA", `Malformed metadata entry '${part}' in '${tok}'`, {
            column: col,
            token: tok,
          }),
        );
        return null;
      }
      const key = entryMatch[1]!;
      const value = entryMatch[2];
      if (!KNOWN_META_KEYS.has(key)) {
        errors.push(
          mkError(line, "UNKNOWN_METADATA_KEY", `Unknown metadata key '${key}'`, {
            column: col,
            token: key,
          }),
        );
        return null;
      }
      if (key === "flat" && value !== undefined) {
        errors.push(
          mkError(line, "MALFORMED_METADATA", `'flat' does not take a value, got '${value}'`, {
            column: col,
            token: tok,
          }),
        );
        return null;
      }
      meta.push({ key, value, line });
    }
  }

  return { stringNum, fret, length, meta, token: tok, line, column: col };
}

function parseBarLine(raw: string, line: number, errors: ParseError[]): RawBar | null {
  const leadingWs = raw.length - raw.trimStart().length;
  const headMatch = /^(\s*Bar\s+)(\S+?)(\s*:\s*)(.*)$/.exec(raw);
  if (!headMatch) {
    errors.push(
      mkError(line, "MALFORMED_BAR_LINE", `Malformed bar line: '${raw.trim()}'`, {
        column: leadingWs + 1,
        token: raw.trim(),
      }),
    );
    return null;
  }
  const barNumToken = headMatch[2]!;
  const barNumCol = headMatch[1]!.length + 1;
  if (!/^\d+$/.test(barNumToken)) {
    errors.push(
      mkError(line, "MALFORMED_BAR_LINE", `Bar number must be an integer, got '${barNumToken}'`, {
        column: barNumCol,
        token: barNumToken,
      }),
    );
    return null;
  }
  const barNumber = parseInt(barNumToken, 10);

  let rest = headMatch[4]!;
  let restBaseCol = headMatch[1]!.length + headMatch[2]!.length + headMatch[3]!.length + 1;

  let nOverride: number | null = null;
  if (rest.startsWith("(")) {
    const parenMatch = /^\((\d+)\)/.exec(rest);
    if (!parenMatch) {
      errors.push(
        mkError(line, "MALFORMED_BAR_LINE", `Malformed slot count in bar ${barNumber}`, {
          column: restBaseCol,
          bar: barNumber,
          token: rest,
        }),
      );
      return null;
    }
    nOverride = parseInt(parenMatch[1]!, 10);
    restBaseCol += parenMatch[0].length;
    rest = rest.slice(parenMatch[0].length);
  }

  const tokens = scanTokens(rest, restBaseCol);
  const slotGroups: RawSlotGroup[] = [];
  let currentGroup: RawSlotGroup | null = null;
  let sawError = false;

  for (const { text, col } of tokens) {
    if (text.startsWith("{")) {
      const sm = /^\{(\d+)\}$/.exec(text);
      if (!sm) {
        errors.push(
          mkError(line, "MALFORMED_BAR_LINE", `Malformed slot marker '${text}' in bar ${barNumber}`, {
            column: col,
            bar: barNumber,
            token: text,
          }),
        );
        sawError = true;
        continue;
      }
      currentGroup = { slot: parseInt(sm[1]!, 10), slotToken: text, line, column: col, notes: [] };
      slotGroups.push(currentGroup);
    } else {
      if (!currentGroup) {
        errors.push(
          mkError(
            line,
            "MALFORMED_BAR_LINE",
            `Note '${text}' has no preceding slot marker in bar ${barNumber}`,
            { column: col, bar: barNumber, token: text },
          ),
        );
        sawError = true;
        continue;
      }
      const note = parseNoteToken(text, line, col, errors);
      if (note) currentGroup.notes.push(note);
      else sawError = true;
    }
  }

  if (sawError) return null;
  return { barNumber, nOverride, line, slotGroups };
}

// ---------------------------------------------------------------------------
// Header validation (stage 1: syntax)
// ---------------------------------------------------------------------------

function validateHeader(fields: RawHeaderField[], errors: ParseError[]): SongHeader | null {
  const seen = new Map<string, RawHeaderField>();
  for (const f of fields) {
    if (!(KNOWN_HEADER_KEYS as readonly string[]).includes(f.key)) {
      errors.push(
        mkError(f.line, "UNKNOWN_HEADER_KEY", `Unknown header key '${f.key}'`, { token: f.key }),
      );
      continue;
    }
    if (seen.has(f.key)) {
      errors.push(
        mkError(f.line, "DUPLICATE_HEADER_KEY", `Duplicate header key '${f.key}'`, {
          token: f.key,
        }),
      );
      continue;
    }
    seen.set(f.key, f);
  }

  const firstLine = fields[0]?.line ?? 1;
  for (const required of ["title", "time", "bpm", "unit"]) {
    if (!seen.has(required)) {
      errors.push(
        mkError(firstLine, "MISSING_HEADER_FIELD", `Missing required header field '${required}'`, {
          token: required,
        }),
      );
    }
  }

  let title: string | undefined;
  const titleField = seen.get("title");
  if (titleField) {
    if (titleField.value.trim() === "") {
      errors.push(
        mkError(titleField.line, "MALFORMED_HEADER_LINE", "title must not be empty", {
          token: "title",
        }),
      );
    } else {
      title = titleField.value;
    }
  }

  let time: TimeSignature | undefined;
  const timeField = seen.get("time");
  if (timeField) {
    const m = /^(\d+)\/(\d+)$/.exec(timeField.value.trim());
    const num = m ? parseInt(m[1]!, 10) : NaN;
    const den = m ? parseInt(m[2]!, 10) : NaN;
    if (!m || num < 1 || num > 32 || !VALID_DENOMINATORS.includes(den)) {
      errors.push(
        mkError(
          timeField.line,
          "INVALID_TIME_SIGNATURE",
          `Invalid time signature '${timeField.value}'`,
          { token: timeField.value },
        ),
      );
    } else {
      time = { numerator: num, denominator: den };
    }
  }

  let bpm: number | undefined;
  const bpmField = seen.get("bpm");
  if (bpmField) {
    const v = Number(bpmField.value.trim());
    if (bpmField.value.trim() === "" || !Number.isFinite(v) || v <= 0 || v > 400) {
      errors.push(
        mkError(bpmField.line, "INVALID_BPM", `Invalid bpm '${bpmField.value}'`, {
          token: bpmField.value,
        }),
      );
    } else {
      bpm = v;
    }
  }

  let unit: number | undefined;
  const unitField = seen.get("unit");
  if (unitField) {
    const v = unitField.value.trim();
    if (!/^\d+$/.test(v) || parseInt(v, 10) < 1) {
      errors.push(
        mkError(unitField.line, "INVALID_UNIT", `Invalid unit '${unitField.value}'`, {
          token: unitField.value,
        }),
      );
    } else {
      unit = parseInt(v, 10);
    }
  }

  let youtube: SongHeader["youtube"];
  const youtubeField = seen.get("youtube");
  const offsetField = seen.get("offset");
  if (youtubeField) {
    const videoId = parseYouTubeId(youtubeField.value.trim());
    if (!videoId) {
      errors.push(
        mkError(
          youtubeField.line,
          "INVALID_YOUTUBE_URL",
          `Invalid YouTube URL '${youtubeField.value}'`,
          { token: youtubeField.value },
        ),
      );
    } else if (!offsetField) {
      errors.push(
        mkError(youtubeField.line, "MISSING_OFFSET", "youtube requires an offset field", {
          token: "offset",
        }),
      );
    } else {
      const offVal = Number(offsetField.value.trim());
      if (offsetField.value.trim() === "" || !Number.isFinite(offVal) || offVal < 0) {
        errors.push(
          mkError(offsetField.line, "INVALID_OFFSET", `Invalid offset '${offsetField.value}'`, {
            token: offsetField.value,
          }),
        );
      } else {
        youtube = { url: youtubeField.value.trim(), videoId, offsetSec: offVal };
      }
    }
  } else if (offsetField) {
    errors.push(
      mkError(offsetField.line, "OFFSET_WITHOUT_YOUTUBE", "offset requires a youtube field", {
        token: "offset",
      }),
    );
  }

  if (title === undefined || time === undefined || bpm === undefined || unit === undefined) {
    return null;
  }
  return { title, time, bpm, unit, youtube };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export function parse(text: string): ParseResult {
  const errors: ParseError[] = [];
  const warnings: ParseError[] = [];
  const lines = text.split(/\r\n|\r|\n/);

  const headerFields: RawHeaderField[] = [];
  const rawSections: RawSection[] = [];
  let currentSection: RawSection | null = null;
  let barsStartedInCurrentSection = false;

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1;
    const raw = lines[i]!;
    const trimmed = raw.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    const leadingWs = raw.length - raw.trimStart().length;

    if (trimmed.startsWith("[")) {
      const m = /^\[([^\]]*)\]$/.exec(trimmed);
      if (!m) {
        errors.push(
          mkError(lineNo, "MALFORMED_SECTION_LINE", `Malformed section line: '${trimmed}'`, {
            column: leadingWs + 1,
            token: trimmed,
          }),
        );
        continue;
      }
      currentSection = { name: m[1]!, nameLine: lineNo, fields: [], bars: [] };
      rawSections.push(currentSection);
      barsStartedInCurrentSection = false;
      continue;
    }

    if (/^Bar\b/.test(trimmed)) {
      if (!currentSection) {
        errors.push(
          mkError(lineNo, "UNRECOGNIZED_LINE", `Bar line found before any section: '${trimmed}'`, {
            column: leadingWs + 1,
            token: trimmed,
          }),
        );
        continue;
      }
      const barRaw = parseBarLine(raw, lineNo, errors);
      if (barRaw) {
        currentSection.bars.push(barRaw);
        barsStartedInCurrentSection = true;
      }
      continue;
    }

    const kv = /^([A-Za-z][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!kv) {
      errors.push(
        mkError(lineNo, "UNRECOGNIZED_LINE", `Unrecognized line: '${trimmed}'`, {
          column: leadingWs + 1,
          token: trimmed,
        }),
      );
      continue;
    }
    const key = kv[1]!;
    const value = kv[2]!.trim();

    if (!currentSection) {
      headerFields.push({ key, value, line: lineNo });
    } else if (key === "bpm" || key === "unit") {
      if (barsStartedInCurrentSection) {
        errors.push(
          mkError(
            lineNo,
            "MISPLACED_SECTION_FIELD",
            `Section field '${key}' must appear before the section's first bar`,
            { column: leadingWs + 1, token: key },
          ),
        );
      } else {
        currentSection.fields.push({ key, value, line: lineNo });
      }
    } else {
      errors.push(
        mkError(lineNo, "UNRECOGNIZED_LINE", `Unknown section field '${key}'`, {
          column: leadingWs + 1,
          token: key,
        }),
      );
    }
  }

  if (rawSections.length === 0) {
    errors.push(mkError(lines.length || 1, "NO_SECTIONS", "Song must contain at least one section"));
  }

  const seenNames = new Set<string>();
  for (const s of rawSections) {
    if (seenNames.has(s.name)) {
      warnings.push(
        mkWarning(s.nameLine, "DUPLICATE_SECTION_NAME", `Duplicate section name '${s.name}'`, {
          token: s.name,
        }),
      );
    } else {
      seenNames.add(s.name);
    }
  }

  const header = validateHeader(headerFields, errors);

  for (const s of rawSections) {
    for (const f of s.fields) {
      if (f.key === "bpm") {
        const v = Number(f.value.trim());
        if (f.value.trim() === "" || !Number.isFinite(v) || v <= 0 || v > 400) {
          errors.push(mkError(f.line, "INVALID_BPM", `Invalid bpm '${f.value}'`, { token: f.value }));
        }
      } else {
        const v = f.value.trim();
        if (!/^\d+$/.test(v) || parseInt(v, 10) < 1) {
          errors.push(mkError(f.line, "INVALID_UNIT", `Invalid unit '${f.value}'`, { token: f.value }));
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  const resolvedHeader = header!;
  const barTicks =
    resolvedHeader.time.numerator * (WHOLE_NOTE_TICKS / resolvedHeader.time.denominator);

  interface ResolvedSection {
    name: string;
    nameLine: number;
    bpm: number;
    unit: number;
    bars: RawBar[];
  }

  const resolvedSections: ResolvedSection[] = rawSections.map((s) => {
    let bpm = resolvedHeader.bpm;
    let unit = resolvedHeader.unit;
    for (const f of s.fields) {
      if (f.key === "bpm") bpm = Number(f.value.trim());
      else unit = parseInt(f.value.trim(), 10);
    }
    return { name: s.name, nameLine: s.nameLine, bpm, unit, bars: s.bars };
  });

  for (const s of resolvedSections) {
    if (s.bars.length === 0) {
      errors.push(
        mkError(s.nameLine, "EMPTY_SECTION", `Section '${s.name}' has no bars`, { token: s.name }),
      );
    }
  }

  let expectedBarNumber = 1;
  for (const s of resolvedSections) {
    for (const b of s.bars) {
      if (b.barNumber !== expectedBarNumber) {
        errors.push(
          mkError(
            b.line,
            "BAR_NUMBER_GAP",
            `Expected bar ${expectedBarNumber}, found bar ${b.barNumber}`,
            { bar: b.barNumber, token: String(b.barNumber) },
          ),
        );
      }
      expectedBarNumber = b.barNumber + 1;
    }
  }

  for (const s of resolvedSections) {
    for (const b of s.bars) {
      const n = b.nOverride ?? s.unit;
      if (n < 1) {
        errors.push(
          mkError(b.line, "INVALID_SLOT_COUNT", `Slot count must be at least 1, got ${n}`, {
            bar: b.barNumber,
            token: String(n),
          }),
        );
      } else if (barTicks % n !== 0) {
        errors.push(
          mkError(
            b.line,
            "SLOT_COUNT_NOT_DIVISIBLE",
            `Slot count ${n} does not divide the bar's ${barTicks} ticks evenly`,
            { bar: b.barNumber, token: String(n) },
          ),
        );
      }

      let prevSlot = 0;
      for (const g of b.slotGroups) {
        if (g.slot < 1 || (n >= 1 && g.slot > n)) {
          errors.push(
            mkError(g.line, "SLOT_OUT_OF_RANGE", `Slot ${g.slot} is out of range 1..${n}`, {
              bar: b.barNumber,
              slot: g.slot,
              column: g.column,
              token: g.slotToken,
            }),
          );
        }
        if (g.slot <= prevSlot) {
          errors.push(
            mkError(
              g.line,
              "SLOT_NOT_INCREASING",
              `Slot markers must be strictly increasing (got ${g.slot} after ${prevSlot})`,
              { bar: b.barNumber, slot: g.slot, column: g.column, token: g.slotToken },
            ),
          );
        }
        prevSlot = g.slot;

        const stringsSeen = new Set<number>();
        for (const note of g.notes) {
          if (stringsSeen.has(note.stringNum)) {
            errors.push(
              mkError(
                note.line,
                "DUPLICATE_STRING_IN_SLOT",
                `Multiple notes on string ${note.stringNum} in the same slot`,
                { bar: b.barNumber, slot: g.slot, column: note.column, token: note.token },
              ),
            );
          }
          stringsSeen.add(note.stringNum);
        }
      }
    }
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  let tickCursor = 0;
  const sections: Section[] = [];
  const flatNotes: Note[] = [];
  const lastNoteForString = new Map<number, { fret: number }>();

  for (const s of resolvedSections) {
    const bars: Bar[] = [];
    for (const b of s.bars) {
      const n = b.nOverride ?? s.unit;
      const slotTicks = barTicks / n;
      const barStartTick = tickCursor;
      const barNotes: Note[] = [];

      for (const g of b.slotGroups) {
        const slotStartTick = barStartTick + (g.slot - 1) * slotTicks;
        for (const rn of g.notes) {
          if (rn.stringNum < 1 || rn.stringNum > 6) {
            errors.push(
              mkError(rn.line, "INVALID_STRING", `String must be 1-6, got ${rn.stringNum}`, {
                bar: b.barNumber,
                slot: g.slot,
                column: rn.column,
                token: rn.token,
              }),
            );
          }
          if (rn.fret < 0 || rn.fret > 24) {
            errors.push(
              mkError(rn.line, "INVALID_FRET", `Fret must be 0-24, got ${rn.fret}`, {
                bar: b.barNumber,
                slot: g.slot,
                column: rn.column,
                token: rn.token,
              }),
            );
          }

          let durationTicks: number;
          let offsetMs = 0;
          let uncertain = false;

          if (rn.length === null) {
            durationTicks = slotTicks;
          } else {
            offsetMs = rn.length.offsetMs ?? 0;
            uncertain = rn.length.uncertain;

            if (rn.length.kind === "units") {
              const k = rn.length.k!;
              if (k < 1) {
                errors.push(
                  mkError(rn.line, "INVALID_LENGTH_COUNT", `Length count must be at least 1, got ${k}`, {
                    bar: b.barNumber,
                    slot: g.slot,
                    column: rn.column,
                    token: rn.token,
                  }),
                );
                durationTicks = slotTicks;
              } else {
                durationTicks = k * slotTicks;
              }
            } else if (rn.length.kind === "fraction") {
              const k = rn.length.k!;
              const a = rn.length.a!;
              const bb = rn.length.b!;
              if (k < 1 || a < 1 || bb < 1) {
                errors.push(
                  mkError(rn.line, "INVALID_LENGTH_COUNT", `Invalid length '${rn.length.raw}'`, {
                    bar: b.barNumber,
                    slot: g.slot,
                    column: rn.column,
                    token: rn.token,
                  }),
                );
                durationTicks = slotTicks;
              } else {
                const exact = (k * WHOLE_NOTE_TICKS * a) / bb;
                if (!Number.isInteger(exact)) {
                  errors.push(
                    mkError(
                      rn.line,
                      "LENGTH_NOT_INTEGER_TICKS",
                      `Length '${rn.length.raw}' is not a whole number of ticks`,
                      { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                    ),
                  );
                  durationTicks = slotTicks;
                } else {
                  durationTicks = exact;
                }
              }
            } else {
              durationTicks = slotTicks;
            }

            if (offsetMs < -500 || offsetMs > 500) {
              errors.push(
                mkError(
                  rn.line,
                  "INVALID_NOTE_OFFSET",
                  `Offset ${offsetMs}ms out of range -500..500`,
                  { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                ),
              );
              offsetMs = Math.max(-500, Math.min(500, offsetMs));
            }
          }

          if (slotStartTick - barStartTick + durationTicks > barTicks) {
            errors.push(
              mkError(rn.line, "NOTE_EXCEEDS_BAR", `Note extends past the end of bar ${b.barNumber}`, {
                bar: b.barNumber,
                slot: g.slot,
                column: rn.column,
                token: rn.token,
              }),
            );
          }

          const meta: NoteMeta = {};
          const connectionEntries = rn.meta.filter((e) => CONNECTION_KEYS.has(e.key));
          if (connectionEntries.length > 1) {
            errors.push(
              mkError(rn.line, "MULTIPLE_CONNECTION_FLAGS", "At most one connection flag is allowed", {
                bar: b.barNumber,
                slot: g.slot,
                column: rn.column,
                token: rn.token,
              }),
            );
          }
          const hasSlideIn = rn.meta.some((e) => e.key === "slide_in");
          if (hasSlideIn && connectionEntries.length >= 1) {
            errors.push(
              mkError(
                rn.line,
                "SLIDE_IN_WITH_CONNECTION",
                "slide_in cannot combine with a connection flag",
                { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
              ),
            );
          }

          let connectionKind: ConnectionKind | "bend" | null = null;
          let bendSemitones = 0;
          if (connectionEntries.length >= 1) {
            const entry = connectionEntries[0]!;
            if (entry.key === "bend") {
              const rawVal = entry.value?.trim() ?? "";
              const num = Number(rawVal);
              const validStep =
                rawVal !== "" &&
                Number.isFinite(num) &&
                num >= 0 &&
                num <= 4 &&
                Math.abs(num * 2 - Math.round(num * 2)) < 1e-9;
              if (!validStep) {
                errors.push(
                  mkError(rn.line, "INVALID_BEND_VALUE", `Invalid bend value '${entry.value ?? ""}'`, {
                    bar: b.barNumber,
                    slot: g.slot,
                    column: rn.column,
                    token: rn.token,
                  }),
                );
              } else {
                connectionKind = "bend";
                bendSemitones = num;
              }
            } else {
              connectionKind = entry.key as ConnectionKind;
            }
          }

          for (const e of rn.meta) {
            if (e.key === "strum") {
              if (e.value !== "up" && e.value !== "down") {
                errors.push(
                  mkError(
                    rn.line,
                    "INVALID_STRUM_VALUE",
                    `strum must be 'up' or 'down', got '${e.value ?? ""}'`,
                    { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                  ),
                );
              } else {
                meta.strum = e.value;
              }
            } else if (e.key === "slide_in") meta.slideIn = true;
            else if (e.key === "slide_out") meta.slideOut = true;
            else if (e.key === "vibrato") meta.vibrato = true;
            else if (e.key === "muted") meta.muted = true;
            else if (e.key === "flat") meta.flat = true;
          }

          if (meta.flat) {
            const pitchClass = ((pitchOf(rn.stringNum as StringNumber, rn.fret) % 12) + 12) % 12;
            if (NATURAL_PITCH_CLASSES.has(pitchClass)) {
              errors.push(
                mkError(
                  rn.line,
                  "FLAT_ON_NATURAL",
                  `'flat' cannot apply to string ${rn.stringNum} fret ${rn.fret}: that note is a natural (no black key), so it cannot be spelled flat`,
                  { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                ),
              );
            }
          }

          // hammer and bend need no previous note and have no fret rule: a note
          // can be hammered on "from nowhere", or picked and bent right away
          // (user decisions, 2026-09-26). A bend on the same fret as the
          // previous note is a continuation of it; otherwise it is picked.
          if (connectionKind && connectionKind !== "hammer" && connectionKind !== "bend") {
            const prev = lastNoteForString.get(rn.stringNum);
            if (!prev) {
              errors.push(
                mkError(
                  rn.line,
                  "NO_PREVIOUS_NOTE",
                  `No previous note on string ${rn.stringNum} to connect from`,
                  { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                ),
              );
            } else if (connectionKind === "pull" && !(rn.fret < prev.fret)) {
              errors.push(
                mkError(
                  rn.line,
                  "INVALID_PULL",
                  `pull requires a lower fret than the previous note (${prev.fret})`,
                  { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                ),
              );
            } else if (connectionKind === "slide" && rn.fret === prev.fret) {
              errors.push(
                mkError(
                  rn.line,
                  "INVALID_SLIDE",
                  `slide requires a different fret than the previous note (${prev.fret})`,
                  { bar: b.barNumber, slot: g.slot, column: rn.column, token: rn.token },
                ),
              );
            }
            meta.connection = { kind: connectionKind };
          } else if (connectionKind === "hammer") {
            meta.connection = { kind: "hammer" };
          } else if (connectionKind === "bend") {
            meta.connection = { kind: "bend", semitones: bendSemitones };
          }

          lastNoteForString.set(rn.stringNum, { fret: rn.fret });

          const note: Note = {
            string: rn.stringNum as StringNumber,
            fret: rn.fret,
            startTick: slotStartTick,
            durationTicks,
            offsetMs,
            uncertain,
            meta,
            source: { line: rn.line, column: rn.column },
          };
          barNotes.push(note);
          flatNotes.push(note);
        }
      }

      barNotes.sort((x, y) => x.startTick - y.startTick || x.string - y.string);

      bars.push({
        number: b.barNumber,
        startTick: barStartTick,
        lengthTicks: barTicks,
        slots: n,
        notes: barNotes,
      });

      tickCursor += barTicks;
    }

    sections.push({ name: s.name, bpm: s.bpm, unit: s.unit, bars });
  }

  if (errors.length > 0) {
    return { ok: false, errors, warnings };
  }

  flatNotes.sort((x, y) => x.startTick - y.startTick || x.string - y.string);

  const song: Song = {
    header: resolvedHeader,
    sections,
    notes: flatNotes,
    totalTicks: tickCursor,
  };

  return { ok: true, song, warnings };
}
