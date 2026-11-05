// Read-only sheet with a "Play notes" button (no mic, no video): used by the
// open library, reply previews and the direct-share page.

import { useEffect, useMemo, useRef, useState } from "react";
import { Play, Square } from "lucide-react";
import type { Settings, Song } from "../../model";
import { computeLayout } from "../../layout";
import { Sheet, buildSongIndex } from "../../render";
import { GuitarPlayer, buildPlayPlan, getAudioContext, resumeAudio } from "../../audio";
import { GridClock } from "../../clock";
import { TempoMap } from "../../tempo";
import { useElementWidth } from "../useElementWidth";
import { Button } from "../components/kit";
import st from "./sharing.module.css";

/** Plays the song's notes through the synthetic guitar from a plain grid clock. */
export function useNotesPlayer(song: Song | null) {
  const [playing, setPlaying] = useState(false);
  const live = useRef<{ clock: GridClock; guitar: GuitarPlayer; timer: number } | null>(null);

  function stop() {
    const l = live.current;
    live.current = null;
    if (l) {
      window.clearTimeout(l.timer);
      l.guitar.stop();
      l.clock.dispose();
    }
    setPlaying(false);
  }

  async function play() {
    if (!song) return;
    stop();
    await resumeAudio();
    const ctx = getAudioContext();
    const tempo = new TempoMap(song);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    const guitar = new GuitarPlayer(ctx, song, tempo);
    guitar.setVolume(0.7);
    guitar.setEnabled(true);
    guitar.attach(clock);
    guitar.start();
    const endSec = Math.max(0, ...buildPlayPlan(song, tempo).map((p) => p.endSec)) + 2;
    const timer = window.setTimeout(stop, endSec * 1000);
    live.current = { clock, guitar, timer };
    setPlaying(true);
    await clock.play();
  }

  // Stop when the song changes or the preview goes away.
  useEffect(() => stop, [song]); // eslint-disable-line react-hooks/exhaustive-deps
  return { playing, toggle: () => (playing ? stop() : void play()), stop };
}

export function SongPreview({
  song,
  settings,
  actions,
  compact = false,
}: {
  song: Song;
  settings: Settings;
  /** Extra buttons next to Play notes. */
  actions?: React.ReactNode;
  compact?: boolean;
}) {
  const [widthRef, width] = useElementWidth(compact ? 420 : 700);
  const lanes = useMemo(() => ({ ...settings.lanes, letter: true }), [settings.lanes]);
  const layout = useMemo(() => computeLayout(song, { viewportWidth: width, zoom: settings.zoom, lanes }), [song, width, settings.zoom, lanes]);
  const songIndex = useMemo(() => buildSongIndex(song), [song]);
  const player = useNotesPlayer(song);
  return (
    <div className={st.preview}>
      <div className={st.previewBar}>
        <Button variant="primary" icon={player.playing ? <Square size={14} fill="currentColor" /> : <Play size={15} fill="currentColor" />} onClick={player.toggle}>
          {player.playing ? "Stop" : "Play notes"}
        </Button>
        {actions}
      </div>
      <div className={`${st.sheetBox}${compact ? ` ${st.sheetCompact}` : ""}`} ref={widthRef}>
        <Sheet song={song} layout={layout} songIndex={songIndex} lanes={lanes} onReady={() => {}} />
      </div>
    </div>
  );
}
