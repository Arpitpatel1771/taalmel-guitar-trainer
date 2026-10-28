// Name-that-chord quiz logic (chord practice spec section 2). Pure and seedable.

import { CHORD_TYPES, SLASH_CHORDS, chordDisplayName, chordKey, listVoicings, openChordList } from "../index.js";
import type { ChordTypeId, Spelling, Voicing } from "../types.js";

export type QuizChord = { rootPc: number; typeId: ChordTypeId; spelling: Spelling } | { slash: string };
export type QuizKind = "name" | "find";
export type QuizPool = "mine" | "open" | "all";
export type Rng = () => number;

export const QUESTIONS_PER_ROUND = 10;
export const OPTION_COUNT = 4;

export interface QuizQuestion {
  kind: QuizKind;
  answer: QuizChord;
  /** OPTION_COUNT unique chords (by key), the answer among them. */
  options: QuizChord[];
  correctIndex: number;
}

/** Small deterministic RNG (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function quizKey(c: QuizChord): string {
  return "slash" in c ? `slash:${c.slash}` : chordKey(c.rootPc, c.typeId);
}

export function quizName(c: QuizChord): string {
  return "slash" in c ? c.slash : chordDisplayName(c.rootPc, c.typeId, c.spelling);
}

export function quizVoicing(c: QuizChord): Voicing | undefined {
  if ("slash" in c) return SLASH_CHORDS.find((s) => s.name === c.slash)?.voicing;
  return listVoicings(c.rootPc, c.typeId)[0];
}

function dedupe(list: QuizChord[]): QuizChord[] {
  const seen = new Set<string>();
  return list.filter((c) => {
    const k = quizKey(c);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Every root x type that has a voicing (sharp spelling), plus the slash chords. */
export function allChords(): QuizChord[] {
  const out: QuizChord[] = [];
  for (let rootPc = 0; rootPc < 12; rootPc++) {
    for (const t of CHORD_TYPES) {
      if (listVoicings(rootPc, t.id).length > 0) out.push({ rootPc, typeId: t.id, spelling: "sharp" });
    }
  }
  for (const s of SLASH_CHORDS) out.push({ slash: s.name });
  return out;
}

export function openChords(): QuizChord[] {
  return dedupe(openChordList().map((o) => ({ rootPc: o.rootPc, typeId: o.typeId, spelling: "sharp" as Spelling })));
}

/** The chords a round draws its questions from. `mine` falls back to open chords when empty. */
export function poolChords(pool: QuizPool, mine: QuizChord[]): QuizChord[] {
  const usable = (c: QuizChord) => quizVoicing(c) !== undefined;
  if (pool === "all") return allChords().filter((c) => !("slash" in c));
  if (pool === "mine") {
    const m = dedupe(mine).filter(usable);
    if (m.length > 0) return m;
  }
  return openChords();
}

function shuffle<T>(list: readonly T[], rng: Rng): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function pcDistance(a: number, b: number): number {
  const d = Math.abs(a - b) % 12;
  return Math.min(d, 12 - d);
}

function shapeSimilarity(a: Voicing | undefined, b: Voicing | undefined): number {
  if (!a || !b) return 0;
  let n = 0;
  for (let i = 0; i < 6; i++) if (a.frets[i] === b.frets[i]) n++;
  return n / 6;
}

/** How plausible `c` is as a wrong answer for `answer` (higher is better). */
export function distractorScore(answer: QuizChord, c: QuizChord): number {
  let score = shapeSimilarity(quizVoicing(answer), quizVoicing(c)) * 2;
  if ("slash" in answer || "slash" in c) {
    // Slash chords look like their upper chord.
    const a = "slash" in answer ? SLASH_CHORDS.find((s) => s.name === answer.slash) : undefined;
    const b = "slash" in c ? SLASH_CHORDS.find((s) => s.name === c.slash) : undefined;
    const ar = a ? a.rootPc : "rootPc" in answer ? answer.rootPc : -1;
    const br = b ? b.rootPc : "rootPc" in c ? c.rootPc : -1;
    if (ar === br) score += 2;
    return score;
  }
  if (c.rootPc === answer.rootPc) score += 3; // same root, other type
  if (c.typeId === answer.typeId) {
    const d = pcDistance(c.rootPc, answer.rootPc);
    if (d <= 2) score += 3 - (d - 1) * 0.5; // nearby root, same type
  }
  return score;
}

/**
 * Builds one question. Distractors come from the whole chord universe (so tiny
 * pools still work), are unique by key (no enharmonic duplicates of the
 * answer), and favour the same root, nearby roots of the same type, and
 * similar shapes, with some randomness so rounds vary.
 */
export function buildQuestion(kind: QuizKind, answer: QuizChord, pool: readonly QuizChord[], rng: Rng): QuizQuestion {
  const answerKey = quizKey(answer);
  const poolKeys = new Set(pool.map(quizKey));
  const candidates = allChords().filter((c) => quizKey(c) !== answerKey);
  const scored = candidates
    .map((c) => ({ c, s: distractorScore(answer, c) + (poolKeys.has(quizKey(c)) ? 0.5 : 0) + rng() * 2 }))
    .sort((x, y) => y.s - x.s);
  const distractors = scored.slice(0, OPTION_COUNT - 1).map((x) => x.c);
  const options = shuffle([answer, ...distractors], rng);
  return { kind, answer, options, correctIndex: options.findIndex((o) => quizKey(o) === answerKey) };
}

/** A round of questions; answers cycle through the shuffled pool without repeats until it is used up. */
export function generateRound(
  kind: QuizKind,
  pool: readonly QuizChord[],
  rng: Rng,
  count: number = QUESTIONS_PER_ROUND,
): QuizQuestion[] {
  if (pool.length === 0) return [];
  const answers: QuizChord[] = [];
  let bag: QuizChord[] = [];
  let last: string | null = null;
  while (answers.length < count) {
    if (bag.length === 0) {
      bag = shuffle(pool, rng);
      // Avoid the same chord twice in a row across cycles.
      if (pool.length > 1 && last !== null && quizKey(bag[0]) === last) bag.push(bag.shift()!);
    }
    const next = bag.shift()!;
    answers.push(next);
    last = quizKey(next);
  }
  return answers.map((a) => buildQuestion(kind, a, pool, rng));
}

export type QuizStats = Record<string, { seen: number; correct: number }>;

/** Adds a round's results to the per-chord stats (does not mutate). */
export function recordResults(stats: QuizStats, results: { key: string; correct: boolean }[]): QuizStats {
  const next: QuizStats = { ...stats };
  for (const r of results) {
    const prev = next[r.key] ?? { seen: 0, correct: 0 };
    next[r.key] = { seen: prev.seen + 1, correct: prev.correct + (r.correct ? 1 : 0) };
  }
  return next;
}
