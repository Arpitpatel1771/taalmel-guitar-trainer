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
  meta: NoteMeta;
  source: { line: number; column: number }; // for editor highlighting
}

export interface Bar {
  number: number; // 1-based, global
  startTick: number;
  lengthTicks: number;
  slots: number; // n
  capo: number; // effective (song value or section override), 0 = none
  notes: Note[]; // sorted by startTick, then string
}

export interface Section {
  name: string;
  bpm: number; // effective
  unit: number; // effective default slots
  capo: number; // effective
  bars: Bar[];
}

export interface SongHeader {
  title: string;
  /** Optional performer or band; absent = not given. Written right after `title`. */
  artist?: string;
  time: TimeSignature;
  bpm: number;
  unit: number;
  capo?: number; // 0..12, absent = no capo
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

export type LaneId = "tab" | "letter";
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

export type ThemePref = "system" | "dark" | "light";
export type AccentId = "saffron" | "teal" | "violet";
export const THEME_PREFS: readonly ThemePref[] = ["system", "dark", "light"];
export const ACCENT_IDS: readonly AccentId[] = ["saffron", "teal", "violet"];

export interface Settings {
  /** Colour mode. Device-local (not synced). "system" follows prefers-color-scheme. */
  theme: ThemePref;
  /** Accent colour (synced). The logo stays saffron. */
  accent: AccentId;
  calibration: Calibration | null;
  lanes: Record<LaneId, boolean>;
  zoom: number; // px per bar, 120..800
  defaultMode: PracticeMode;
  metronomeVolume: number; // 0..1
  metronomeMuted: boolean;
  subdivisionClicks: boolean;
  tiers: TimingTiers;
  countIn: boolean;
  /** Bars of rest between loop passes (the transport's "Rest between loops"). */
  restBars: 0 | 1 | 2 | 4;
  /** The transport's BPM ramp on loop, as last set (absent = off with the defaults). */
  bpmRamp?: {
    enabled: boolean;
    startBpm: number;
    stepBpm: number;
    maxBpm: number | null;
    condition: { kind: "passes"; count: number } | { kind: "accuracy"; count: number; minOnTimePct: number };
  };
  /** Song editor listen controls as last set (absent = defaults: click on only without a video). */
  editorListen?: { click?: boolean; follow?: boolean; balance?: number };
  /** Start the mic automatically on the first Play press of a practice
   * session (a user gesture, needed for AudioContext resume + the
   * permission prompt), unless the user has turned it off. The transport's
   * mic toggle updates this. Default true. */
  micEnabled: boolean;
  persistBannerDismissed: boolean;
  /** Tuner reference pitch for A4, Hz (430..450). */
  a4Hz: number;
  /** "Play notes": synthetic guitar plays the song. */
  playNotes: boolean;
  playNotesVolume: number; // 0..1
  chordMarks: Record<string, "learning" | "known">;
  chordView: {
    orientation: "vertical" | "horizontal";
    labels: "fingers" | "intervals";
    noteNames: boolean;
  };
  leftHanded: boolean;
  /** Chord practice results (chord practice spec "Shared"). */
  chordStats: ChordStats;
  /** Private sharing key (JWK), backed up in synced settings once Drive is connected so another device can read replies (specs/5-11-shared-library.md 3.2). */
  sharingKeyBackup?: JsonWebKey;
}

export interface ChordStats {
  /** Keyed by the two chord keys, sorted and joined with "|". */
  changes: Record<string, { best: number; history: { at: string; count: number; seconds: number }[] }>;
  /** Keyed by chordKey. */
  quiz: Record<string, { seen: number; correct: number }>;
}

export const DEFAULT_SETTINGS: Settings = {
  theme: "system",
  accent: "saffron",
  calibration: null,
  lanes: { tab: true, letter: true },
  zoom: 240,
  defaultMode: "grid",
  metronomeVolume: 0.7,
  metronomeMuted: false,
  subdivisionClicks: false,
  tiers: { onTimeMs: 30, closeMs: 80, missWindowMs: 150 },
  countIn: true,
  restBars: 0,
  micEnabled: true,
  persistBannerDismissed: false,
  a4Hz: 440,
  playNotes: false,
  playNotesVolume: 0.6,
  chordMarks: {},
  chordView: { orientation: "vertical", labels: "fingers", noteNames: false },
  leftHanded: false,
  chordStats: { changes: {}, quiz: {} },
};

export interface SongRecord {
  id: string;
  text: string;
  title: string;
  bpm: number;
  hasVideo: boolean;
  /** Set when the song is a copy of an open-library entry (specs/5-11-shared-library.md 2). */
  libraryId?: string;
  libraryVersion?: string;
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
  capo: number; // capo of the bar these notes are in
}

export interface Verdict {
  kind: "matched" | "missed" | "extra";
  expected?: ExpectedEvent;
  onsetSec?: number; // song seconds, latency-corrected
  errorMs?: number; // signed: onset - expected (negative = early)
  tier?: TimingTier;
  pitch?: PitchVerdict;
  /** MIDI note actually heard when `pitch` is "wrong" (spec 5-11-ui-redesign 6.2). */
  playedMidi?: number;
}
