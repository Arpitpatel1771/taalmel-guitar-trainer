// Home hub (specs/5-11-ui-redesign.md 4): continue the last song, repeat the
// last chord-changes pair, and a toolbox of every tool. First visit shows
// "Start here" cards instead.

import { useEffect, useState, type ReactNode } from "react";
import { ArrowRight, AudioLines, Dumbbell, Gauge, Guitar, Metronome, Music, Play, RefreshCw, Repeat } from "lucide-react";
import type { Song } from "../../model";
import { parse } from "../../songFormat";
import { SAMPLE_SONGS } from "../../samples";
import { loadRecentChords, loadRecentSong, type RecentChords, type RecentSong } from "../../storage/recent";
import type { StorageAdapter } from "../storageTypes";
import { Button, Card, IconTile, Pill } from "../components/kit";
import { detailLine, playStyleFact, previewBars, takeFact, timeOfDayLine } from "./homeHelpers";
import st from "./Home.module.css";

export type HomeTarget = "library" | "shared" | "new-song" | "chords" | "exercises" | "recorder" | "tuner" | "metronome" | "calibration" | "changes";

const SAMPLE_ID = "ode-to-joy";

const TOOLS: { target: HomeTarget; name: string; text: string; icon: ReactNode }[] = [
  { target: "tuner", name: "Tuner", text: "Tune each string by ear or with the mic.", icon: <Gauge size={22} /> },
  { target: "metronome", name: "Metronome", text: "A steady click, from 20 to 999 BPM.", icon: <Metronome size={22} /> },
  { target: "chords", name: "Chord library", text: "Look up any chord and hear it.", icon: <Guitar size={22} /> },
  { target: "changes", name: "Chord changes", text: "See how many clean changes fit in a minute.", icon: <Repeat size={22} /> },
  { target: "exercises", name: "Exercises", text: "Warm-ups and drills you can play along to.", icon: <Dumbbell size={22} /> },
  { target: "recorder", name: "Recordings", text: "Record yourself and trim your takes.", icon: <AudioLines size={22} /> },
];

interface SongInfo {
  song: Song | null;
}

/** Loads the song behind the recent record. null = the song is gone. */
async function loadSong(storage: StorageAdapter, r: RecentSong): Promise<SongInfo | null> {
  let text: string | undefined;
  if (r.sample) text = SAMPLE_SONGS.find((s) => s.id === r.songId)?.text;
  else {
    try {
      text = (await storage.getSong(r.songId))?.text;
    } catch {
      text = undefined;
    }
  }
  if (text === undefined) return null;
  const p = parse(text);
  return { song: p.ok ? p.song : null };
}

export function Home({
  storage,
  onOpen,
  onContinue,
  onGoAgain,
  onOpenSample,
  slot,
}: {
  storage: StorageAdapter;
  onOpen: (target: HomeTarget) => void;
  onContinue: (r: RecentSong) => void;
  onGoAgain: (pair: [string, string]) => void;
  onOpenSample: (id: string) => void;
  /** Extra cards under the greeting (sharing: replies and request nudges). */
  slot?: ReactNode;
}) {
  // Read after mount, not during render: the practice view flushes its latest
  // loop/speed when it unmounts, which happens after Home's first render.
  const [loaded, setLoaded] = useState(false);
  const [recentSong, setRecentSong] = useState<RecentSong | null>(null);
  const [recentChords, setRecentChords] = useState<RecentChords | null>(null);
  const [info, setInfo] = useState<SongInfo | null | undefined>(null);

  useEffect(() => {
    const r = loadRecentSong();
    setRecentSong(r);
    setInfo(r ? undefined : null);
    setRecentChords(loadRecentChords());
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!recentSong) return;
    let off = false;
    void loadSong(storage, recentSong).then((i) => {
      if (!off) setInfo(i);
    });
    return () => {
      off = true;
    };
  }, [recentSong, storage]);

  const showSong = !!recentSong && !!info;
  const showChords = !!recentChords;
  // While the song is still loading, hold back so the row does not jump.
  const loading = !loaded || (!!recentSong && info === undefined);
  const firstVisit = !showSong && !showChords && !loading;

  return (
    <div className={`screen ${st.page}`}>
      <header className={st.head}>
        {firstVisit ? (
          <>
            <h1 className={st.title}>Welcome to Taalmel</h1>
            <p className={st.sub}>A set of practice tools for guitar: a tuner, a metronome, chords and songs you can play along to.</p>
          </>
        ) : (
          <>
            <p className={st.eyebrow}>{timeOfDayLine(new Date())}</p>
            <h1 className={st.title}>Pick up where you left off</h1>
          </>
        )}
      </header>

      {slot}

      {firstVisit ? (
        <>
          <h2 className={st.section}>Start here</h2>
          <div className={st.start}>
            <StartCard icon={<Gauge size={22} />} name="Tune your guitar" text="Get each string in tune before anything else." onClick={() => onOpen("tuner")} />
            <StartCard icon={<Music size={22} />} name="Try a sample song" text="Ode to Joy, a gentle first tune to play along with." onClick={() => onOpenSample(SAMPLE_ID)} />
            <StartCard icon={<Guitar size={22} />} name="Learn your first chords" text="See the shapes and hear how they sound." onClick={() => onOpen("chords")} />
          </div>
        </>
      ) : (
        <div className={`${st.continue}${showSong && showChords ? "" : ` ${st.single}`}`}>
          {showSong && recentSong && info ? <SongCard recent={recentSong} song={info.song} onContinue={() => onContinue(recentSong)} /> : null}
          {showChords && recentChords ? <ChordsCard recent={recentChords} onGoAgain={() => onGoAgain(recentChords.pair)} /> : null}
        </div>
      )}

      <h2 className={st.section}>Your toolbox</h2>
      <div className={st.grid}>
        {TOOLS.map((t) => (
          <button key={t.target} type="button" className={st.tile} onClick={() => onOpen(t.target)}>
            <Card className={st.card}>
              <IconTile>{t.icon}</IconTile>
              <span className={st.name}>{t.name}</span>
              <span className={st.text}>{t.text}</span>
            </Card>
          </button>
        ))}
      </div>
    </div>
  );
}

function StartCard({ icon, name, text, onClick }: { icon: ReactNode; name: string; text: string; onClick: () => void }) {
  return (
    <button type="button" className={st.tile} onClick={onClick}>
      <Card className={st.card}>
        <IconTile>{icon}</IconTile>
        <span className={st.name}>{name}</span>
        <span className={st.text}>{text}</span>
        <span className={st.go}>
          Start <ArrowRight size={16} />
        </span>
      </Card>
    </button>
  );
}

function SongCard({ recent, song, onContinue }: { recent: RecentSong; song: Song | null; onContinue: () => void }) {
  const facts = [takeFact(recent.lastTake), song ? playStyleFact(song) : null].filter((f): f is string => !!f).slice(0, 2);
  return (
    <Card className={st.big}>
      <span className={st.label}>Song</span>
      <h3 className={st.songTitle}>{recent.title}</h3>
      <p className={st.detail}>{detailLine(song, recent)}</p>
      {song ? <TabPreview song={song} recent={recent} /> : null}
      <div className={st.bottom}>
        <Button variant="primary" size="lg" icon={<Play size={18} fill="currentColor" />} onClick={onContinue}>
          Continue
        </Button>
        {facts.map((f) => (
          <Pill key={f}>{f}</Pill>
        ))}
      </div>
    </Card>
  );
}

function ChordsCard({ recent, onGoAgain }: { recent: RecentChords; onGoAgain: () => void }) {
  return (
    <Card className={st.chordsCard}>
      <span className={st.label}>Chord changes</span>
      <p className={st.pair}>
        {recent.pair[0]} <span className={st.arrow}>→</span> {recent.pair[1]}
      </p>
      <p className={st.detail}>One-minute changes.{recent.best !== undefined ? ` Best so far: ${recent.best}.` : ""}</p>
      <div className={st.bottom}>
        <Button icon={<RefreshCw size={16} />} onClick={onGoAgain}>
          Go again
        </Button>
      </div>
    </Card>
  );
}

const PREVIEW_W = 480;
const PREVIEW_H = 84;
const PAD_X = 10;

/** A few bars of the tab around the saved position; the accent line is the cursor. */
function TabPreview({ song, recent }: { song: Song; recent: RecentSong }) {
  const bars = previewBars(song, recent, 4);
  if (bars.length === 0) return null;
  const barW = (PREVIEW_W - PAD_X * 2) / bars.length;
  const lineY = (s: number) => 14 + (s - 1) * 11.2;
  return (
    <svg className={st.preview} viewBox={`0 0 ${PREVIEW_W} ${PREVIEW_H}`} role="img" aria-label={`Preview of bar ${bars[0].number} onward`}>
      {[1, 2, 3, 4, 5, 6].map((s) => (
        <line key={s} x1={PAD_X} x2={PREVIEW_W - PAD_X} y1={lineY(s)} y2={lineY(s)} className={st.staff} />
      ))}
      {bars.map((b, i) => {
        const x0 = PAD_X + i * barW;
        return (
          <g key={b.number}>
            <line x1={x0} x2={x0} y1={lineY(1)} y2={lineY(6)} className={st.barLine} />
            <text x={x0 + 4} y={PREVIEW_H - 4} className={st.barNo}>
              {b.number}
            </text>
            {b.notes.map((n, k) => {
              const x = x0 + 8 + ((n.startTick - b.startTick) / b.lengthTicks) * (barW - 16);
              return (
                <text key={k} x={x} y={lineY(n.string) + 3.5} textAnchor="middle" className={st.fret}>
                  {n.fret}
                </text>
              );
            })}
          </g>
        );
      })}
      <line x1={PAD_X + 1} x2={PAD_X + 1} y1={6} y2={lineY(6) + 8} className={st.cursor} />
    </svg>
  );
}
