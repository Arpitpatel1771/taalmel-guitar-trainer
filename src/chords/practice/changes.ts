// Pure helpers for the one-minute changes practice (chord practice spec section 1).

import type { ChordStats } from "../../model";

export const HISTORY_LIMIT = 20;

export type ChangesRun = { at: string; count: number; seconds: number };

/** Order-independent key for a pair of chord keys. */
export function pairKey(keyA: string, keyB: string): string {
  return [keyA, keyB].sort().join("|");
}

/** Changes per minute, rounded to one decimal. */
export function perMinute(count: number, seconds: number): number {
  if (seconds <= 0) return 0;
  return Math.round((count * 60 * 10) / seconds) / 10;
}

/** Records a run; best is compared on the per-minute figure. */
export function recordRun(
  stats: ChordStats,
  key: string,
  run: ChangesRun,
): { stats: ChordStats; isBest: boolean; previousBest: number | null } {
  const prev = stats.changes[key];
  const rate = perMinute(run.count, run.seconds);
  const previousBest = prev ? prev.best : null;
  const isBest = previousBest === null ? run.count > 0 : rate > previousBest;
  const history = [...(prev?.history ?? []), run].slice(-HISTORY_LIMIT);
  const best = isBest ? rate : (previousBest ?? 0);
  return { stats: { ...stats, changes: { ...stats.changes, [key]: { best, history } } }, isBest, previousBest };
}
