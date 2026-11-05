// Pure helpers for the Home hub (specs/5-11-ui-redesign.md 4).

import type { Bar, Song } from "../../model";
import type { RecentSong } from "../../storage/recent";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "Thursday evening": weekday plus a part of the day. */
export function timeOfDayLine(d: Date): string {
  const h = d.getHours();
  const part = h < 5 ? "night" : h < 12 ? "morning" : h < 17 ? "afternoon" : h < 22 ? "evening" : "night";
  return `${DAYS[d.getDay()]} ${part}`;
}

/** "Last take: 9 of 12 notes on time", or null without a take. */
export function takeFact(take: RecentSong["lastTake"]): string | null {
  if (!take || take.total <= 0) return null;
  return `Last take: ${take.onTime} of ${take.total} notes on time`;
}

/** "Chords" when any moment has three or more notes at once, else "Single notes". */
export function playStyleFact(song: Song): "Chords" | "Single notes" {
  const counts = new Map<number, number>();
  for (const n of song.notes) {
    const c = (counts.get(n.startTick) ?? 0) + 1;
    if (c >= 3) return "Chords";
    counts.set(n.startTick, c);
  }
  return "Single notes";
}

function allBars(song: Song): Bar[] {
  return song.sections.flatMap((s) => s.bars);
}

/** "Section A · bars 1–8 looped". Parts that do not apply are left out. */
export function detailLine(song: Song | null, r: RecentSong): string {
  const parts: string[] = [];
  const sec = song?.sections[r.sectionIndex];
  if (sec && song && song.sections.length > 1) parts.push(sec.name || `Section ${r.sectionIndex + 1}`);
  if (r.loop) {
    const { startBar, endBar } = r.loop;
    parts.push(startBar === endBar ? `bar ${startBar} looped` : `bars ${startBar}–${endBar} looped`);
  }
  return parts.join(" · ");
}

/** The bars to preview: from the loop start (or the saved section's first bar),
 * at most `count`, clamped to the song. The first is where the cursor sits. */
export function previewBars(song: Song, r: Pick<RecentSong, "sectionIndex" | "loop">, count = 4): Bar[] {
  const bars = allBars(song);
  if (bars.length === 0) return [];
  const startNumber = r.loop ? r.loop.startBar : song.sections[r.sectionIndex]?.bars[0]?.number ?? bars[0].number;
  let i = bars.findIndex((b) => b.number === startNumber);
  if (i < 0) i = 0;
  i = Math.min(i, Math.max(0, bars.length - count));
  return bars.slice(i, i + count);
}
