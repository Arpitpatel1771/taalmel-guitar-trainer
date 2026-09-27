// Public API of the exercises module (spec section 12). All generators are
// pure functions returning song text (spec section 5); the output goes
// through the normal parser and player, with no special handling downstream.

export { chromatic, DEFAULT_CHROMATIC_PARAMS } from "./chromatic.js";
export type { ChromaticParams, ChromaticDirection, ChromaticGrid } from "./chromatic.js";

export { spider, DEFAULT_SPIDER_PARAMS } from "./spider.js";
export type { SpiderParams, SpiderGrid } from "./spider.js";

export { rhythm, DEFAULT_RHYTHM_PARAMS, RHYTHM_PRESETS } from "./rhythm.js";
export type { RhythmParams, RhythmPattern, RhythmPresetName, RhythmPreset } from "./rhythm.js";

export { strumming, DEFAULT_STRUMMING_PARAMS, STRUM_PATTERNS, CHORDS } from "./strumming.js";
export type { StrummingParams, StrumPatternName, StrumPattern, ChordName } from "./strumming.js";
