// Shared constants for pitch hints (specs/5-11-piano-roll.md section 5).

/** Lowest analysed MIDI note (E2, the low guitar E). */
export const HINT_MIDI_MIN = 40;
/** Highest analysed MIDI note (E6). */
export const HINT_MIDI_MAX = 88;
/** Number of semitone bins per frame (49). */
export const HINT_BINS = HINT_MIDI_MAX - HINT_MIDI_MIN + 1;
/** Analysis frames per second; also the bucket rate of stored frames. */
export const HINT_FRAME_RATE = 50;
/** Video-time length of one stored bucket, seconds (20 ms). */
export const HINT_BUCKET_SEC = 1 / HINT_FRAME_RATE;
