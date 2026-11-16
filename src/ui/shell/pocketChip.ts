// Text of the live chip on the compact Tools button (specs/8-11-mobile.md §3.2): shows that something
// is running while the Tools sheet is closed. A recording wins over the metronome.

export function pocketChipText(s: { metronomeBpm: number | null; recordingSec: number | null }): string | null {
  if (s.recordingSec !== null) {
    const total = Math.max(0, Math.floor(s.recordingSec));
    const m = Math.floor(total / 60);
    const sec = total - m * 60;
    return `● ${m}:${sec < 10 ? "0" : ""}${sec}`;
  }
  if (s.metronomeBpm !== null) return `♩ ${Math.round(s.metronomeBpm)}`;
  return null;
}
