// Canvas drawing helpers for the envelope strip and verdict markers (spec 9.2,
// 9.4, 9.5). Pure functions over a 2D context so PlaybackController's rAF loop
// can call them without going through React (spec 4.3 rule 3).

import type { TimingTier } from "../model";

const DB_FLOOR = -60;

/** RMS (0..1ish) -> dB, clamped to the -60..0 display floor (spec 9.2). */
function rmsToDb(rms: number): number {
  if (rms <= 0) return DB_FLOOR;
  const db = 20 * Math.log10(rms);
  return Math.max(DB_FLOOR, Math.min(0, db));
}

/**
 * Draws one envelope sample as a vertical bar centered on and mirrored
 * around `centerY` (spec 9.2/section 2 of the fix: the waveform is an
 * overlay behind the notes now, not a strip below them, so it is drawn
 * semi-transparent and mirrors up/down from the lane area's vertical center
 * -- like a classic waveform -- instead of growing up from a floor, keeping
 * notes drawn on top readable). Does not clear the canvas -- callers own
 * when to clear (only on explicit restart, never per point).
 */
export function drawEnvelopePoint(ctx: CanvasRenderingContext2D, x: number, rms: number, rowHeight: number): void {
  const db = rmsToDb(rms);
  const frac = (db - DB_FLOOR) / -DB_FLOOR; // 0..1
  const centerY = rowHeight / 2;
  const halfBar = Math.max(0.5, frac * centerY);
  ctx.fillStyle = "rgba(120, 200, 255, 0.28)";
  ctx.fillRect(x, centerY - halfBar, 1.5, halfBar * 2);
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}

// Okabe-Ito colors (match --verdict-* tokens). Every verdict also has its
// own shape, so none relies on color alone (UI revamp 11, WCAG 1.4.1):
// on time = filled dot, close = hollow ring, off = diamond, missed = dashed
// tick with an x, extra = plus. Pitch: right = solid ring, wrong = dashed
// ring, unknown = dotted grey ring.
const TIER_COLORS: Record<TimingTier, string> = {
  onTime: "#009e73",
  close: "#e69f00",
  off: "#d55e00",
};
const MISSED_COLOR = "#cc79a7";
const EXTRA_COLOR = "#999999";

const PITCH_STYLE: Record<string, { color: string; dash: number[] }> = {
  right: { color: "#009e73", dash: [] },
  wrong: { color: "#d55e00", dash: [3, 2] },
  unknown: { color: "#999999", dash: [1, 2] },
};

/** Draws a matched-verdict marker: a tier-shaped mark at the onset x, a thin
 * connector to the expected x so early/late is visible at a glance (spec 9.4),
 * and, if a pitch verdict is already known, a styled ring around it (spec 9.5).
 * `y` is the row's vertical center (same axis the envelope overlay mirrors
 * around), so markers sit on the same overlay, behind the lanes/notes. */
export function drawMatchedMarker(
  ctx: CanvasRenderingContext2D,
  onsetX: number,
  expectedX: number,
  y: number,
  tier: TimingTier,
  pitch?: string,
): void {
  const color = TIER_COLORS[tier];
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(expectedX, y);
  ctx.lineTo(onsetX, y);
  ctx.stroke();

  ctx.beginPath();
  if (tier === "onTime") {
    ctx.fillStyle = color;
    ctx.arc(onsetX, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (tier === "close") {
    ctx.lineWidth = 2;
    ctx.arc(onsetX, y, 4, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    ctx.fillStyle = color;
    ctx.moveTo(onsetX, y - 5.5);
    ctx.lineTo(onsetX + 5.5, y);
    ctx.lineTo(onsetX, y + 5.5);
    ctx.lineTo(onsetX - 5.5, y);
    ctx.closePath();
    ctx.fill();
  }

  ctx.beginPath();
  ctx.lineWidth = 1;
  ctx.moveTo(expectedX, y - 5);
  ctx.lineTo(expectedX, y + 5);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();

  const ps = pitch ? PITCH_STYLE[pitch] : undefined;
  if (ps) {
    ctx.strokeStyle = ps.color;
    ctx.lineWidth = 1.5;
    ctx.setLineDash(ps.dash);
    ctx.beginPath();
    ctx.arc(onsetX, y, 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

export function drawMissedMarker(ctx: CanvasRenderingContext2D, expectedX: number, y: number): void {
  ctx.strokeStyle = MISSED_COLOR;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(expectedX, y - 7);
  ctx.lineTo(expectedX, y + 7);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(expectedX - 3, y - 3);
  ctx.lineTo(expectedX + 3, y + 3);
  ctx.moveTo(expectedX + 3, y - 3);
  ctx.lineTo(expectedX - 3, y + 3);
  ctx.stroke();
}

export function drawExtraMarker(ctx: CanvasRenderingContext2D, onsetX: number, y: number): void {
  ctx.strokeStyle = EXTRA_COLOR;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(onsetX - 3.5, y);
  ctx.lineTo(onsetX + 3.5, y);
  ctx.moveTo(onsetX, y - 3.5);
  ctx.lineTo(onsetX, y + 3.5);
  ctx.stroke();
}
