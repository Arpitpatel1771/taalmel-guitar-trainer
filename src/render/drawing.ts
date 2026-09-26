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

const TIER_COLORS: Record<TimingTier, string> = {
  onTime: "#4ade80",
  close: "#facc15",
  off: "#f87171",
};

const PITCH_COLORS: Record<string, string> = {
  right: "#22c55e",
  wrong: "#ef4444",
  unknown: "#9ca3af",
  skipped: "transparent",
};

/** Draws a matched-verdict marker: a dot at the onset x, a thin connector to
 * the expected x so early/late is visible at a glance (spec 9.4), and,
 * if a pitch verdict is already known, a colored ring around it (spec 9.5).
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
  ctx.strokeStyle = TIER_COLORS[tier];
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(expectedX, y);
  ctx.lineTo(onsetX, y);
  ctx.stroke();

  ctx.fillStyle = TIER_COLORS[tier];
  ctx.beginPath();
  ctx.arc(onsetX, y, 4, 0, Math.PI * 2);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(expectedX, y - 5);
  ctx.lineTo(expectedX, y + 5);
  ctx.strokeStyle = "rgba(255,255,255,0.5)";
  ctx.stroke();

  if (pitch && pitch !== "skipped") {
    ctx.strokeStyle = PITCH_COLORS[pitch] ?? "#9ca3af";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(onsetX, y, 7, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function drawMissedMarker(ctx: CanvasRenderingContext2D, expectedX: number, y: number): void {
  ctx.strokeStyle = "rgba(156,163,175,0.9)";
  ctx.lineWidth = 1;
  ctx.setLineDash([2, 2]);
  ctx.beginPath();
  ctx.moveTo(expectedX, y - 6);
  ctx.lineTo(expectedX, y + 6);
  ctx.stroke();
  ctx.setLineDash([]);
}

export function drawExtraMarker(ctx: CanvasRenderingContext2D, onsetX: number, y: number): void {
  ctx.fillStyle = "rgba(168,85,247,0.9)";
  ctx.beginPath();
  ctx.arc(onsetX, y, 3, 0, Math.PI * 2);
  ctx.fill();
}
