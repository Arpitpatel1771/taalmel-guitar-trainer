// Finds a tempo written in a pasted tab ("128 bpm", "Tempo: 128", "BPM = 128",
// "♩=128", "q=128"). Returns whole bpm, or null when the text names none.

const MIN = 20;
const MAX = 999;

const PATTERNS: RegExp[] = [
  /\b(?:tempo|bpm)\s*[:=-]?\s*(\d{2,3}(?:\.\d+)?)/i,
  /(\d{2,3}(?:\.\d+)?)\s*bpm\b/i,
  /[♩♪♫]\s*=\s*(\d{2,3}(?:\.\d+)?)/,
  /\bq\s*=\s*(\d{2,3}(?:\.\d+)?)/i,
];

export function parseTempo(text: string): number | null {
  for (const re of PATTERNS) {
    const m = re.exec(text);
    if (!m) continue;
    const bpm = Math.round(Number(m[1]));
    if (bpm >= MIN && bpm <= MAX) return bpm;
  }
  return null;
}
