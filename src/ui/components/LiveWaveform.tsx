// Live, scrolling mic waveform for the recorder: one peak bar per animation
// frame, newest on the right. Turns red (and shows "Clipping") when the input
// hits full scale. Analysis only: the analyser is never connected to the
// speakers.

import { useEffect, useRef, useState } from "react";
import { getAudioContext } from "../../audio";
import st from "../screens/Recorder.module.css";

const BAR_PX = 2;
const GAP_PX = 1;
const CLIP_LEVEL = 0.98;
const CLIP_HOLD_MS = 1500;

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function LiveWaveform({ stream, recording }: { stream: MediaStream; recording: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [clipping, setClipping] = useState(false);
  const recordingRef = useRef(recording);
  recordingRef.current = recording;

  useEffect(() => {
    if (stream.getAudioTracks().length === 0) return;
    const ctx = getAudioContext();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const history: { peak: number; clip: boolean }[] = [];
    let raf = 0;
    let clipUntil = 0;

    const draw = () => {
      raf = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      if (!canvas) return;
      analyser.getFloatTimeDomainData(buf);
      let peak = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = Math.abs(buf[i]);
        if (v > peak) peak = v;
      }
      const now = performance.now();
      const clip = peak >= CLIP_LEVEL;
      if (clip) clipUntil = now + CLIP_HOLD_MS;
      setClipping(now < clipUntil);

      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
      if (canvas.height !== Math.round(h * dpr)) canvas.height = Math.round(h * dpr);
      const max = Math.ceil(w / (BAR_PX + GAP_PX));
      history.push({ peak: Math.min(1, peak), clip });
      if (history.length > max) history.splice(0, history.length - max);

      const g = canvas.getContext("2d");
      if (!g) return;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, w, h);
      const mid = h / 2;
      const normal = recordingRef.current ? cssVar("--accent", "#f2a93b") : cssVar("--text-secondary", "#999");
      const danger = cssVar("--danger", "#e5484d");
      for (let i = 0; i < history.length; i++) {
        const x = w - (history.length - i) * (BAR_PX + GAP_PX);
        const half = Math.max(1, history[i].peak * (mid - 1));
        g.fillStyle = history[i].clip ? danger : normal;
        g.fillRect(x, mid - half, BAR_PX, half * 2);
      }
    };
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      source.disconnect();
    };
  }, [stream]);

  return (
    <div className={st.liveWave}>
      <canvas ref={canvasRef} className={st.liveWaveCanvas} aria-label="Microphone level" />
      {clipping && <span className={st.clipBadge}>Clipping</span>}
    </div>
  );
}
