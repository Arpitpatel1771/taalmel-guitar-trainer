// Stable machine error codes for the song text format (spec section 5).
//
// Validation runs in three stages (spec 5.8), collecting all errors within a stage
// before stopping at that stage:
//   1. SYNTAX     - line forms, token grammar, header required fields.
//   2. STRUCTURE  - bar numbering, slot ranges/ordering, grid divisibility,
//                   distinct strings per slot, length fits in bar.
//   3. SEMANTICS  - connection flag rules, metadata value ranges, fret/string range.
//
// The exact code list is an implementation decision (the spec gives only one example,
// "BAR_NUMBER_GAP"); grouping below documents which stage produces each code.

export const SYNTAX_ERROR_CODES = [
  "UNRECOGNIZED_LINE",
  "MALFORMED_HEADER_LINE",
  "UNKNOWN_HEADER_KEY",
  "DUPLICATE_HEADER_KEY",
  "MISSING_HEADER_FIELD",
  "INVALID_TIME_SIGNATURE",
  "INVALID_BPM",
  "INVALID_UNIT",
  "INVALID_YOUTUBE_URL",
  "MISSING_OFFSET",
  "OFFSET_WITHOUT_YOUTUBE",
  "INVALID_OFFSET",
  "NO_SECTIONS",
  "MALFORMED_SECTION_LINE",
  "MISPLACED_SECTION_FIELD",
  "MALFORMED_BAR_LINE",
  "MALFORMED_NOTE_TOKEN",
  "MALFORMED_METADATA",
  "UNKNOWN_METADATA_KEY",
] as const;

export const STRUCTURE_ERROR_CODES = [
  "EMPTY_SECTION",
  "BAR_NUMBER_GAP",
  "INVALID_SLOT_COUNT",
  "SLOT_COUNT_NOT_DIVISIBLE",
  "SLOT_OUT_OF_RANGE",
  "SLOT_NOT_INCREASING",
  "DUPLICATE_STRING_IN_SLOT",
  "INVALID_LENGTH_COUNT",
  "LENGTH_NOT_INTEGER_TICKS",
  "NOTE_EXCEEDS_BAR",
] as const;

export const SEMANTIC_ERROR_CODES = [
  "INVALID_STRING",
  "INVALID_FRET",
  "INVALID_NOTE_OFFSET",
  "INVALID_BEND_VALUE",
  "INVALID_STRUM_VALUE",
  "NO_PREVIOUS_NOTE",
  "INVALID_HAMMER",
  "INVALID_PULL",
  "INVALID_SLIDE",
  "INVALID_BEND_FRET",
  "MULTIPLE_CONNECTION_FLAGS",
  "SLIDE_IN_WITH_CONNECTION",
  "FLAT_ON_NATURAL",
] as const;

export const WARNING_CODES = ["DUPLICATE_SECTION_NAME"] as const;

export const ERROR_CODES = [
  ...SYNTAX_ERROR_CODES,
  ...STRUCTURE_ERROR_CODES,
  ...SEMANTIC_ERROR_CODES,
  ...WARNING_CODES,
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
