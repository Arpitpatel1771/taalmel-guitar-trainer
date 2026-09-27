// Pure types shared by every module (spec section 6). No logic here.

export type StringNumber = 1 | 2 | 3 | 4 | 5 | 6;

export const PPQ = 960;
export const WHOLE_NOTE_TICKS = PPQ * 4;

export interface TimeSignature {
  numerator: number;
  denominator: number;
}

export type ConnectionKind = "hammer" | "pull" | "slide";

export interface NoteMeta {
  connection?: { kind: ConnectionKind } | { kind: "bend"; semitones: number };
  slideIn?: boolean;
  slideOut?: boolean;
  vibrato?: boolean;
  muted?: boolean;
  strum?: "up" | "down";
  flat?: boolean;
}

export interface Note {
  string: StringNumber;
  fret: number; // 0..24
  startTick: number; // absolute from song start
  durationTicks: number;
  offsetMs: number; // default 0
  uncertain: boolean;
  meta: NoteMeta;
  source: { line: number; column: number }; // for editor highlighting
}

export interface Bar {
  number: number; // 1-based, global
  startTick: number;
  lengthTicks: number;
  slots: number; // n
  notes: Note[]; // sorted by startTick, then string
}

export interface Section {
  name: string;
  bpm: number; // effective
  unit: number; // effective default slots
  bars: Bar[];
}

export interface SongHeader {
  title: string;
  time: TimeSignature;
  bpm: number;
  unit: number;
  youtube?: { url: string; videoId: string; offsetSec: number };
}

export interface Song {
  header: SongHeader;
  sections: Section[];
  notes: Note[]; // flat, all notes sorted by startTick then string
  totalTicks: number;
}

export interface ParseError {
  line: number; // 1-based line in the input text
  column?: number; // 1-based
  bar?: number;
  slot?: number;
  token?: string;
  code: string; // stable machine code, e.g. "BAR_NUMBER_GAP"
  message: string; // human sentence, used verbatim in repair prompts
  severity?: "error" | "warning"; // absent = error
}

export type ParseResult =
  | { ok: true; song: Song; warnings: ParseError[] }
  | { ok: false; errors: ParseError[]; warnings: ParseError[] };

export type LaneId = "tab" | "letter" | "teacher";
export type PracticeMode = "grid" | "video";

export interface Calibration {
  latencyMs: number;
  method: "loopback" | "tap";
  measuredAt: string; // ISO 8601
}

export interface TimingTiers {
  onTimeMs: number; // default 30
  closeMs: number; // default 80
  missWindowMs: number; // default 150
}

export interface Settings {
  calibration: Calibration | null;
  lanes: Record<LaneId, boolean>;
  zoom: number; // px per bar, 120..800
  defaultMode: PracticeMode;
  metronomeVolume: number; // 0..1
  metronomeMuted: boolean;
  subdivisionClicks: boolean;
  tiers: TimingTiers;
  countIn: boolean;
  /** Start the mic automatically on the first Play press of a practice
   * session (a user gesture, needed for AudioContext resume + the
   * permission prompt), unless the user has turned it off. The transport's
   * mic toggle updates this. Default true. */
  micEnabled: boolean;
  persistBannerDismissed: boolean;
  /** Tuner reference pitch for A4, Hz (430..450). */
  a4Hz: number;
}

export const DEFAULT_SETTINGS: Settings = {
  calibration: null,
  lanes: { tab: true, letter: true, teacher: false },
  zoom: 240,
  defaultMode: "grid",
  metronomeVolume: 0.7,
  metronomeMuted: false,
  subdivisionClicks: false,
  tiers: { onTimeMs: 30, closeMs: 80, missWindowMs: 150 },
  countIn: true,
  micEnabled: true,
  persistBannerDismissed: false,
  a4Hz: 440,
};

export interface SongRecord {
  id: string;
  text: string;
  title: string;
  bpm: number;
  hasVideo: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ClockState {
  playing: boolean;
  buffering?: boolean;
}

// Mic feedback
export type TimingTier = "onTime" | "close" | "off";
export type PitchVerdict = "right" | "wrong" | "unknown" | "skipped";

export interface ExpectedEvent {
  tick: number;
  timeSec: number; // song seconds incl. offsetMs
  notes: Note[]; // picked notes starting at this tick
}

export interface Verdict {
  kind: "matched" | "missed" | "extra";
  expected?: ExpectedEvent;
  onsetSec?: number; // song seconds, latency-corrected
  errorMs?: number; // signed: onset - expected (negative = early)
  tier?: TimingTier;
  pitch?: PitchVerdict;
}
