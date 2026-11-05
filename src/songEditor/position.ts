// "Bar 3, beat 2 + 1/16" for the inspector and hover text.

import { WHOLE_NOTE_TICKS } from "../model/index.js";
import { barLengthTicks } from "./doc.js";
import type { EdDoc } from "./types.js";

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}

/** Beat = the time signature's note value (an eighth in 6/8). The part after the beat is a fraction of a whole note. */
export function positionText(doc: EdDoc, tick: number): string {
  const len = barLengthTicks(doc);
  const t = Math.max(0, Math.round(tick));
  const bar = Math.floor(t / len);
  const inBar = t - bar * len;
  const beatTicks = WHOLE_NOTE_TICKS / doc.header.time.denominator;
  const beat = Math.floor(inBar / beatTicks);
  const rest = inBar - beat * beatTicks;
  let s = `Bar ${bar + 1}, beat ${beat + 1}`;
  if (rest > 0) {
    const g = gcd(rest, WHOLE_NOTE_TICKS);
    s += ` + ${rest / g}/${WHOLE_NOTE_TICKS / g}`;
  }
  return s;
}
