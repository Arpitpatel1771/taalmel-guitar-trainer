// Static clip waveform for the trimmer: mirrored peak bars, the selected range
// in the accent colour and the rest dimmed. Display only: seeking, handles,
// flags and the playhead are DOM elements layered on top by ClipTrimmer.

import { useEffect, useRef, useState } from "react";
import { peaksToColumns } from "../../recording";

const BAR_PX = 2;
const GAP_PX = 1;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function WaveformCanvas({
  peaks,
  duration,
  start,
  end,
  className,
}: {
  /** null while computing (or unavailable): a flat line is drawn instead. */
  peaks: number[] | null;
  duration: number;
  start: number;
  end: number;
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setSize({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0 || size.h === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, size.w, size.h);

    const on = cssVar("--accent", "#f2a93b");
    const off = cssVar("--border-strong", "#555");
    const mid = size.h / 2;
    const inSel = (x: number) => {
      const t = duration > 0 ? (x / size.w) * duration : 0;
      return t >= start && t <= end;
    };

    if (!peaks) {
      for (let x = 0; x < size.w; x += BAR_PX + GAP_PX) {
        g.fillStyle = inSel(x) ? on : off;
        g.fillRect(x, mid - 1, BAR_PX, 2);
      }
      return;
    }
    const columns = Math.floor(size.w / (BAR_PX + GAP_PX));
    const cols = peaksToColumns(peaks, columns);
    for (let c = 0; c < cols.length; c++) {
      const x = c * (BAR_PX + GAP_PX);
      const half = Math.max(1, cols[c] * (mid - 2));
      g.fillStyle = inSel(x + BAR_PX / 2) ? on : off;
      g.fillRect(x, mid - half, BAR_PX, half * 2);
    }
  }, [peaks, duration, start, end, size]);

  return <canvas ref={canvasRef} className={className} aria-hidden />;
}
