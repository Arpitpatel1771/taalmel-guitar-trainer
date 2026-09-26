// The single rAF loop (spec 4.3 rule 3, 8.4, 8.5, 9.2, 9.4): reads the active
// Clock, positions the cursor via a DOM transform, drives auto-scroll, and
// draws envelope/verdict data into row canvases. Never touches React state.

import type { Clock } from "../clock";
import type { TempoMap } from "../tempo";
import type { Layout } from "../layout";
import { rowIndexForTick, tickToX } from "../layout";
import type { Verdict } from "../model";
import {
  clearCanvas,
  drawEnvelopePoint,
  drawExtraMarker,
  drawMatchedMarker,
  drawMissedMarker,
} from "./drawing";

export interface PlaybackControllerOptions {
  clock: Clock;
  tempo: TempoMap;
  getLayout: () => Layout;
  container: HTMLElement;
  cursorEl: HTMLElement;
  getRowCanvas: (rowIndex: number) => HTMLCanvasElement | null;
  onRowChange?: (rowIndex: number) => void;
  onFollowChange?: (following: boolean) => void;
  /** Element showing "bar:beat"; its text is written directly each frame. */
  getPositionEl?: () => HTMLElement | null;
  /** Ticks per metronome beat, for the bar:beat readout. */
  beatTicks?: number;
}

interface EnvelopePoint {
  songSec: number;
  rms: number;
}

const SCROLL_TARGET_FRACTION = 0.4;
const SCROLL_EASE_MS = 250;

export class PlaybackController {
  private lastRowIndex = -1;
  private following = true;
  private scrollAnim: { fromTop: number; toTop: number; startMs: number } | null = null;
  private programmaticScroll = false;
  private envelopeQueue: EnvelopePoint[] = [];
  private verdictQueue: Verdict[] = [];
  private rafHandle: number | null = null;
  private disposed = false;

  constructor(private readonly opts: PlaybackControllerOptions) {
    opts.container.addEventListener("scroll", this.onScroll);
    opts.container.addEventListener("wheel", this.onManualScrollHint, { passive: true });
    opts.container.addEventListener("touchmove", this.onManualScrollHint, { passive: true });
    opts.container.addEventListener("keydown", this.onKeyDown);
  }

  private onScroll = (): void => {
    if (this.programmaticScroll) return;
    this.onManualScrollHint();
  };

  private onManualScrollHint = (): void => {
    if (!this.opts.clock.isPlaying()) return;
    if (this.following) {
      this.following = false;
      this.scrollAnim = null;
      this.opts.onFollowChange?.(false);
    }
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"]);
    if (scrollKeys.has(e.key)) this.onManualScrollHint();
  };

  isFollowing(): boolean {
    return this.following;
  }

  /** Re-enables follow and immediately scrolls to the active row's target
   * (spec 8.5: the "Resume follow" button's action). */
  resumeFollow(): void {
    this.following = true;
    this.opts.onFollowChange?.(true);
    const layout = this.opts.getLayout();
    if (layout.rows.length === 0) return;
    const tick = this.opts.clock.positionTick();
    const rowIndex = rowIndexForTick(layout, tick);
    this.beginScrollAnim(layout.rows[rowIndex]);
  }

  pushEnvelopePoint(songSec: number, rms: number): void {
    this.envelopeQueue.push({ songSec, rms });
  }

  pushVerdict(v: Verdict): void {
    this.verdictQueue.push(v);
  }

  /** Clears every row's envelope canvas -- called on stop+restart, never on
   * a loop pass (spec 9.2: past rows keep their drawing until restart). */
  clearAllCanvases(rowCount: number): void {
    for (let i = 0; i < rowCount; i++) {
      const canvas = this.opts.getRowCanvas(i);
      if (canvas) clearCanvas(canvas);
    }
  }

  start(): void {
    if (this.rafHandle !== null) return;
    const loop = (): void => {
      this.frame();
      if (!this.disposed) this.rafHandle = requestAnimationFrame(loop);
    };
    this.rafHandle = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop();
    this.opts.container.removeEventListener("scroll", this.onScroll);
    this.opts.container.removeEventListener("wheel", this.onManualScrollHint);
    this.opts.container.removeEventListener("touchmove", this.onManualScrollHint);
    this.opts.container.removeEventListener("keydown", this.onKeyDown);
  }

  private lastPositionText = "";

  private writePosition(row: Layout["rows"][number], tick: number): void {
    const el = this.opts.getPositionEl?.();
    if (!el) return;
    let text = "Count-in";
    if (tick >= 0) {
      const bar = row.bars.find((b) => tick >= b.startTick && tick < b.startTick + b.lengthTicks) ?? row.bars[row.bars.length - 1];
      const beat = bar ? Math.floor((tick - bar.startTick) / (this.opts.beatTicks ?? 960)) + 1 : 1;
      text = bar ? `${bar.barNumber}:${beat}` : "";
    }
    if (text !== this.lastPositionText) {
      this.lastPositionText = text;
      el.textContent = text;
    }
  }

  private frame(): void {
    const layout = this.opts.getLayout();
    if (layout.rows.length === 0) return;
    const tick = this.opts.clock.positionTick();
    const rowIndex = rowIndexForTick(layout, tick);
    const row = layout.rows[rowIndex];
    // Clamp to the row start so the count-in (negative ticks) waits at bar 1.
    const x = tickToX(row, Math.max(tick, row.startTick));

    this.opts.cursorEl.style.transform = `translate(${x}px, ${row.y}px)`;
    this.writePosition(row, tick);
    this.opts.cursorEl.style.height = `${row.height}px`;

    // Active-row emphasis (revamp 5.2): toggled imperatively, never via React state.
    this.opts.container.classList.toggle("is-playing", this.opts.clock.isPlaying());
    if (rowIndex !== this.lastRowIndex) {
      this.opts.container.querySelector(`[data-row="${this.lastRowIndex}"]`)?.classList.remove("active-row");
      this.opts.container.querySelector(`[data-row="${rowIndex}"]`)?.classList.add("active-row");
      this.lastRowIndex = rowIndex;
      this.opts.onRowChange?.(rowIndex);
      if (this.following) this.beginScrollAnim(row);
    }

    if (this.following && this.scrollAnim) {
      this.stepScrollAnim();
    }

    this.drainEnvelopeQueue(layout);
    this.drainVerdictQueue(layout);
  }

  private beginScrollAnim(row: { y: number }): void {
    const container = this.opts.container;
    const targetTop = row.y - container.clientHeight * SCROLL_TARGET_FRACTION;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    const clamped = Math.max(0, Math.min(maxScroll, targetTop));
    this.scrollAnim = { fromTop: container.scrollTop, toTop: clamped, startMs: performance.now() };
  }

  private stepScrollAnim(): void {
    if (!this.scrollAnim) return;
    const { fromTop, toTop, startMs } = this.scrollAnim;
    const elapsed = performance.now() - startMs;
    const t = Math.min(1, elapsed / SCROLL_EASE_MS);
    const eased = 1 - Math.pow(1 - t, 3);
    const value = fromTop + (toTop - fromTop) * eased;
    this.programmaticScroll = true;
    this.opts.container.scrollTop = value;
    window.setTimeout(() => {
      this.programmaticScroll = false;
    }, 0);
    if (t >= 1) this.scrollAnim = null;
  }

  private drainEnvelopeQueue(layout: Layout): void {
    if (this.envelopeQueue.length === 0) return;
    const items = this.envelopeQueue;
    this.envelopeQueue = [];
    for (const item of items) {
      const tick = this.opts.tempo.secToTicks(item.songSec);
      const rowIndex = rowIndexForTick(layout, tick);
      const row = layout.rows[rowIndex];
      const canvas = this.opts.getRowCanvas(rowIndex);
      if (!canvas) continue;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      const x = tickToX(row, tick) - row.x0;
      // The overlay canvas now spans the whole row (spec 9.2), so mirror
      // around the row's own vertical center rather than a fixed constant.
      drawEnvelopePoint(ctx, x, item.rms, row.height);
    }
  }

  private drainVerdictQueue(layout: Layout): void {
    if (this.verdictQueue.length === 0) return;
    const items = this.verdictQueue;
    this.verdictQueue = [];
    for (const verdict of items) this.drawVerdict(layout, verdict);
  }

  private drawVerdict(layout: Layout, verdict: Verdict): void {
    if (verdict.kind === "matched" && verdict.expected) {
      const rowIndex = rowIndexForTick(layout, verdict.expected.tick);
      const row = layout.rows[rowIndex];
      const canvas = this.opts.getRowCanvas(rowIndex);
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const expectedX = tickToX(row, verdict.expected.tick) - row.x0;
      const onsetTick = this.opts.tempo.secToTicks(verdict.onsetSec ?? verdict.expected.timeSec);
      const onsetX = tickToX(row, onsetTick) - row.x0;
      drawMatchedMarker(ctx, onsetX, expectedX, row.height / 2, verdict.tier ?? "off", verdict.pitch);
    } else if (verdict.kind === "missed" && verdict.expected) {
      const rowIndex = rowIndexForTick(layout, verdict.expected.tick);
      const row = layout.rows[rowIndex];
      const canvas = this.opts.getRowCanvas(rowIndex);
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const expectedX = tickToX(row, verdict.expected.tick) - row.x0;
      drawMissedMarker(ctx, expectedX, row.height / 2);
    } else if (verdict.kind === "extra" && verdict.onsetSec !== undefined) {
      const onsetTick = this.opts.tempo.secToTicks(verdict.onsetSec);
      const rowIndex = rowIndexForTick(layout, onsetTick);
      const row = layout.rows[rowIndex];
      const canvas = this.opts.getRowCanvas(rowIndex);
      const ctx = canvas?.getContext("2d");
      if (!ctx) return;
      const onsetX = tickToX(row, onsetTick) - row.x0;
      drawExtraMarker(ctx, onsetX, row.height / 2);
    }
  }
}
