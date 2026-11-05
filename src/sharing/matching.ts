// Fuzzy title/artist matching (spec 3.6) and duplicate detection (3.5).

import type { BoardRequest } from "./requests.js";

export const MATCH_THRESHOLD = 0.6;
export const DUPLICATE_THRESHOLD = 0.8;
const STOPWORDS = new Set(["the", "a", "an"]);

/** Lowercase, strip diacritics and punctuation, collapse whitespace. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokens(s: string): string[] {
  const all = normalizeText(s).split(" ").filter(Boolean);
  const kept = all.filter((t) => !STOPWORDS.has(t));
  return [...new Set(kept.length ? kept : all)];
}

/** Dice coefficient over token sets, 0..1. Two empty strings score 0. */
export function tokenOverlap(a: string, b: string): number {
  const ta = tokens(a);
  const tb = new Set(tokens(b));
  if (!ta.length || !tb.size) return 0;
  const common = ta.filter((t) => tb.has(t)).length;
  return (2 * common) / (ta.length + tb.size);
}

export interface Titled {
  title: string;
  artist?: string;
}

/** 0..1. With both artists present: 0.5 title + 0.5 artist; otherwise title only. */
export function matchScore(a: Titled, b: Titled): number {
  const t = tokenOverlap(a.title, b.title);
  if (a.artist?.trim() && b.artist?.trim()) return 0.5 * t + 0.5 * tokenOverlap(a.artist, b.artist);
  return t;
}

export interface RequestMatch<S extends Titled & { id: string }> {
  request: BoardRequest;
  song: S;
  score: number;
}

/** Best-scoring song per open request, at or above `threshold`, best first. */
export function matchRequestsToSongs<S extends Titled & { id: string }>(
  requests: BoardRequest[],
  songs: S[],
  threshold = MATCH_THRESHOLD,
): RequestMatch<S>[] {
  const out: RequestMatch<S>[] = [];
  for (const request of requests) {
    if (request.closed) continue;
    let best: RequestMatch<S> | null = null;
    for (const song of songs) {
      const score = matchScore(request, song);
      if (score >= threshold && (!best || score > best.score)) best = { request, song, score };
    }
    if (best) out.push(best);
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Open requests that look like the same song as a new request. */
export function findDuplicateRequests(
  board: BoardRequest[],
  candidate: Titled,
  threshold = DUPLICATE_THRESHOLD,
): { request: BoardRequest; score: number }[] {
  return board
    .filter((r) => !r.closed)
    .map((request) => ({ request, score: matchScore(request, candidate) }))
    .filter((m) => m.score >= threshold)
    .sort((a, b) => b.score - a.score);
}
