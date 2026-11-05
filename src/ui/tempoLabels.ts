// Tempo display helpers (hard rule "Tempo is always BPM"): every tempo shown to
// the user is an absolute bpm, never a percentage or a multiplier.

import { MAX_BPM, MIN_BPM } from "./usePlaybackEngine";

/** Practice-tempo slider range for a song: about a quarter to double its tempo. */
export function practiceBpmRange(songBpm: number): { min: number; max: number } {
  return {
    min: Math.max(MIN_BPM, Math.round(songBpm * 0.25)),
    max: Math.min(MAX_BPM, Math.round(songBpm * 2)),
  };
}

/** "96 bpm" for a speed factor applied to the song tempo. */
export function factorBpmLabel(songBpm: number, factor: number): string {
  return `${Math.round(songBpm * factor)} bpm`;
}

/** Shortened form used on narrow buttons: "96". */
export function factorBpm(songBpm: number, factor: number): number {
  return Math.round(songBpm * factor);
}
