// Canvas drawing helpers for the envelope strip and verdict markers (spec 9.2,
// 9.4, 9.5). Pure functions over a 2D context so PlaybackController's rAF loop
// can call them without going through React (spec 4.3 rule 3).

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
  ctx.fillStyle = "rgba(140, 132, 119, 0.3)";
  ctx.fillRect(x, centerY - halfBar, 1.5, halfBar * 2);
}

export function clearCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
}
