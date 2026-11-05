// Imperative DOM side of the verdict display (specs/5-11-ui-redesign.md 6.1).
// The rAF controller never goes through React, so marks are written straight
// onto the sheet's note pills (found by data-nk="string:startTick").
// Colours come from CSS classes (styles.css), so both themes just work.

import type { Verdict } from "../model";
import { verdictLook, type VerdictLook } from "./verdictDisplay";

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKS_CLASS = "v-marks";

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

function removeMarks(pill: Element): void {
  pill.querySelector(`.${MARKS_CLASS}`)?.remove();
  pill.removeAttribute("data-verdict");
}

function applyLook(pill: Element, look: VerdictLook): void {
  removeMarks(pill);
  pill.setAttribute("data-verdict", look.timing);
  const head = pill.querySelector("rect.note-head");
  if (!head) return;
  const x = Number(head.getAttribute("x"));
  const y = Number(head.getAttribute("y"));
  const w = Number(head.getAttribute("width"));
  const h = Number(head.getAttribute("height"));
  const cy = y + h / 2;
  const cls = look.timing === "off" ? "v-off" : "v-ontime";

  const g = svg("g", { class: MARKS_CLASS });
  if (look.tick) {
    // 2px x 10px tick: before the number when early, after it when late.
    const tx = look.tick === "early" ? x - 3 : x + w + 1;
    g.appendChild(svg("rect", { class: cls, x: tx, y: cy - 5, width: 2, height: 10, rx: 1 }));
  }
  if (look.underline) {
    g.appendChild(svg("line", { class: `${cls} v-underline`, x1: x + 3, x2: x + w - 3, y1: cy + 11, y2: cy + 11 }));
  }
  if (look.playedLabel) {
    const cw = Math.max(20, look.playedLabel.length * 8 + 10);
    const cx = x + w / 2;
    g.appendChild(svg("rect", { class: "v-chip", x: cx - cw / 2, y: y - 17, width: cw, height: 16, rx: 8 }));
    const t = svg("text", { class: "v-chip-text", x: cx, y: y - 8.5, "text-anchor": "middle", "dominant-baseline": "central" });
    t.textContent = look.playedLabel;
    g.appendChild(t);
  }
  pill.appendChild(g);
}

/** Marks every expected note of a matched/missed verdict; idempotent, so the
 * second call (when the pitch result arrives) replaces the first. */
export function applyNoteVerdict(container: HTMLElement, v: Verdict): void {
  const look = verdictLook(v);
  if (!look || !v.expected) return;
  for (const note of v.expected.notes) {
    const pill = container.querySelector(`[data-nk="${note.string}:${note.startTick}"]`);
    if (pill) applyLook(pill, look);
  }
}

export function addExtraDot(rowEl: HTMLElement, x: number, y: number): void {
  const dot = document.createElement("span");
  dot.className = "extra-dot";
  dot.style.left = `${x}px`;
  dot.style.top = `${y}px`;
  rowEl.appendChild(dot);
}

/** Removes every verdict mark and dot (loop pass, stop, new layout). */
export function clearVerdictMarks(container: HTMLElement): void {
  container.querySelectorAll(".note-pill[data-verdict]").forEach(removeMarks);
  container.querySelectorAll(".extra-dot").forEach((d) => d.remove());
}
