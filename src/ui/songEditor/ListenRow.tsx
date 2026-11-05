// The listen row (spec 2.2): the video and the transport card.

import { useState } from "react";
import { AudioLines, Link, Pause, Play, Repeat, Unlink, Video } from "lucide-react";
import type { HintStatus } from "../../audio/hints";
import { SegmentedControl, Slider } from "../components/kit";
import type { HintsHandle } from "./useHints";
import { factorBpm } from "../tempoLabels";
import { SPEEDS, type useEditorPlayback } from "./useEditorPlayback";
import { Toggle, cx } from "./bits";
import s from "./songEditor.module.css";

type Playback = ReturnType<typeof useEditorPlayback>;

const STATUS_TEXT: Record<HintStatus, string> = {
  recording: "Hearing this tab's audio",
  "paused-own-sounds": "Hints paused: your notes are playing",
  "paused-video": "Ready: play the video to record hints",
  stopped: "",
};

/** "32", "64", "96", "128 bpm": bpm of each speed, the full speed carrying the unit. */
function speedLabel(bpm: number, factor: number): string {
  const n = factorBpm(bpm, factor);
  return factor === 1 ? `${n} bpm` : String(n);
}

export function ListenRow({
  pb,
  bpm,
  hints,
  hasVideo,
  brightness,
  onBrightness,
  onHintsToggle,
  onRecord,
  loopLabel,
  onToggleLoop,
  onYoutube,
  onLineUp,
}: {
  pb: Playback;
  /** The song's tempo; the speed buttons are labelled in bpm of it. */
  bpm: number;
  hints: HintsHandle;
  hasVideo: boolean;
  brightness: number;
  onBrightness: (v: number) => void;
  onHintsToggle: () => void;
  onRecord: () => void;
  loopLabel: string;
  onToggleLoop: () => void;
  onYoutube: (url: string) => void;
  onLineUp: () => void;
}) {
  const [link, setLink] = useState("");
  const statusText = hints.recording ? STATUS_TEXT[hints.status] : hints.layerOn && hints.hasSaved ? "Showing saved hints" : "";
  return (
    <section className={s.listen} aria-label="Listen">
      {hasVideo ? (
        <div className={s.videoBox}>
          <div ref={pb.videoMountRef} className={s.videoMount} />
          {pb.videoStatus === "loading" && <div className={s.videoNote}>Loading the video…</div>}
          {pb.videoStatus === "error" && <div className={s.videoNote}>{pb.videoError ?? "The video couldn't load."} Playing the metronome only.</div>}
          <div className={cx(s.videoTime, !pb.linked && s.videoTimeTop)}>{pb.timeLabel}</div>
        </div>
      ) : (
        <div className={s.noVideo}>
          <Video size={28} aria-hidden />
          <div>No video yet. Paste a YouTube link to play along and see pitch hints.</div>
          <form
            className={s.row}
            onSubmit={(e) => {
              e.preventDefault();
              if (link.trim()) onYoutube(link.trim());
            }}
          >
            <input className={s.grow} aria-label="YouTube link" placeholder="https://www.youtube.com/watch?v=…" value={link} onChange={(e) => setLink(e.target.value)} />
            <button type="submit" disabled={!link.trim()}>
              Use link
            </button>
          </form>
        </div>
      )}

      <div className={cx(s.transport, !hasVideo && s.transportShort)}>
        <div className={s.row}>
          <button type="button" className={s.playBtn} aria-label={pb.playing ? "Pause" : "Play"} title={pb.playing ? "Pause (Space)" : "Play (Space)"} disabled={!pb.player} onClick={pb.togglePlay}>
            {pb.playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
          </button>
          <Toggle on={pb.loopOn} onClick={onToggleLoop} title="Drag in the ruler to choose what to loop">
            <Repeat size={15} aria-hidden /> {loopLabel}
          </Toggle>
          <SegmentedControl label="Speed" value={pb.speed} onChange={pb.setSpeed} options={SPEEDS.map((v) => ({ value: v as number, label: speedLabel(bpm, v) }))} />
          <Toggle on={pb.clickOn} onClick={() => pb.setClickOn(!pb.clickOn)}>
            Metronome
          </Toggle>
          {hasVideo && (
            <Toggle on={pb.linked} onClick={() => pb.setLinked(!pb.linked)} title="On: the roll and the video play together. Off: move around the video freely while the roll plays on its own">
              {pb.linked ? <Link size={15} aria-hidden /> : <Unlink size={15} aria-hidden />} Link video
            </Toggle>
          )}
          {hasVideo && !pb.linked && (
            <button type="button" onClick={onLineUp} title="Pause the video on a downbeat, put the playhead on the matching bar, then press this">
              Line up here
            </button>
          )}
          <Toggle on={pb.followOn} onClick={() => pb.setFollowOn(!pb.followOn)} title="Scroll the roll to keep the playhead in view">
            Follow
          </Toggle>
        </div>
        {hasVideo && (
          <div className={cx(s.row, s.rowWide)}>
            {hasVideo && (
              <label className={s.balance}>
                Video
                <Slider value={pb.balance} min={0} max={100} step={5} onChange={pb.setBalance} label="Balance between the video and your notes" className={s.balanceSlider} />
                Your notes
              </label>
            )}
            {hasVideo && <span className={s.divider} aria-hidden />}
            {hasVideo && (
              <Toggle on={hints.layerOn} onClick={onHintsToggle} title="Show which pitches the video is playing">
                <AudioLines size={15} aria-hidden /> Pitch hints
              </Toggle>
            )}
            {hasVideo && hints.layerOn && (
              <>
                <label className={s.balance}>
                  Brightness
                  <Slider value={brightness} min={20} max={100} step={5} onChange={onBrightness} label="Hint brightness" className={s.briSlider} />
                </label>
                {statusText && (
                  <span className={cx(s.statusPill, hints.status === "recording" && s.statusLive)}>
                    <span className={s.dot} aria-hidden />
                    {statusText}
                  </span>
                )}
                {hints.status === "paused-own-sounds" && (
                  <button type="button" onClick={pb.listenToVideoOnly}>
                    Listen to the video only
                  </button>
                )}
                {!hints.recording && hints.supported && (
                  <button type="button" onClick={onRecord}>
                    {hints.hasSaved ? "Record more" : "Listen to the video"}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        {hints.error && (
          <div className={s.note} role="status">
            {hints.error}
          </div>
        )}
      </div>
    </section>
  );
}
