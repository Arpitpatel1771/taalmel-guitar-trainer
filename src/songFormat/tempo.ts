// Changing a song's tempo (hard rule "Tempo is always BPM"): the header bpm
// becomes the new value and every per-section bpm override scales by the same
// ratio, so a song with a faster chorus keeps its feel.

import type { Song } from "../model";

export function withSongBpm(song: Song, bpm: number): Song {
  const next = Math.round(bpm);
  const old = song.header.bpm;
  const sectionBpm = (b: number): number => (b === old ? next : Math.max(1, Math.round((b * next) / old)));
  return {
    ...song,
    header: { ...song.header, bpm: next },
    sections: song.sections.map((s) => ({ ...s, bpm: sectionBpm(s.bpm) })),
  };
}
