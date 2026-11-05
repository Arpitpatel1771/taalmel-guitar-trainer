// Requests tab (spec 3.5, 3.6): the board with "Share my version" and Report,
// "You have songs for N requests", and "My requests" with reply previews.

import { useEffect, useMemo, useState } from "react";
import { ExternalLink, Flag, Plus, Send, Users, Video, EyeOff } from "lucide-react";
import type { Settings, Song, SongRecord } from "../../model";
import {
  ReplyTooLargeError,
  hideReply,
  matchRequestsToSongs,
  openRequests,
  parse,
  parseYouTubeId,
  postCloseRequest,
  postReport,
  postShare,
  withSongBpm,
  withYoutubeOffset,
  type BoardRequest,
  type MyReply,
  type MyRequest,
} from "./deps";
import type { StorageAdapter } from "../storageTypes";
import { Button, Card, Pill } from "../components/kit";
import { useShell } from "../shell/AppShellContext";
import { PracticeArea } from "../screens/SongView";
import { AskDialog, NotSetUp } from "./AskCommunity";
import { Dialog } from "./Dialog";
import { SongPreview } from "./SongPreview";
import { useSharing } from "./SharingContext";
import st from "./sharing.module.css";

const PART_LABELS: Record<string, string> = { whole: "Whole song", solo: "Solo", intro: "Intro", riff: "Riff", other: "Other part" };

export function ageText(stamp: string | undefined, now = Date.now()): string {
  const t = stamp ? Date.parse(stamp) : NaN;
  if (Number.isNaN(t)) return "";
  const mins = Math.max(0, Math.round((now - t) / 60000));
  if (mins < 60) return mins <= 1 ? "just now" : `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}

export function RequestsTab({
  storage,
  settings,
  refreshToken,
  onChanged,
  onOpenSong,
  focusRequestId,
  askPrefill,
  onAskDone,
}: {
  storage: StorageAdapter;
  settings: Settings;
  refreshToken: number;
  onChanged: () => void;
  onOpenSong: (id: string) => void;
  focusRequestId?: string;
  /** When set, the ask dialog opens with this title. */
  askPrefill?: string;
  onAskDone: () => void;
}) {
  const sharing = useSharing();
  const [songs, setSongs] = useState<SongRecord[]>([]);
  const [asking, setAsking] = useState<string | null>(askPrefill ?? null);
  const [sharingReq, setSharingReq] = useState<{ request: BoardRequest; songId?: string } | null>(null);
  const [reporting, setReporting] = useState<BoardRequest | null>(null);

  useEffect(() => {
    void storage.listSongs().then(setSongs, () => {});
  }, [storage, refreshToken]);
  useEffect(() => {
    if (sharing.configured) void sharing.refreshBoard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharing.configured]);

  const mineIds = useMemo(() => new Set(sharing.myRequests.map((r) => r.requestId)), [sharing.myRequests]);
  const open = useMemo(() => openRequests(sharing.board ?? []), [sharing.board]);
  const matches = useMemo(() => matchRequestsToSongs(open.filter((r) => !mineIds.has(r.requestId)), songs), [open, songs, mineIds]);

  if (!sharing.configured) return <NotSetUp />;

  return (
    <div className={st.stack}>
      <div className={st.row}>
        <p className={`${st.muted} ${st.grow}`}>Ask for a song, or send your version to people who asked. Songs are encrypted for each person; nobody else can read them.</p>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setAsking("")}>
          Ask the community
        </Button>
      </div>

      <MyRequests storage={storage} settings={settings} focusRequestId={focusRequestId} onChanged={onChanged} onOpenSong={onOpenSong} />

      {matches.length > 0 && (
        <Card className={st.matchBanner}>
          <p className={st.cardTitle}>
            You have songs for {matches.length} {matches.length === 1 ? "request" : "requests"}
          </p>
          <ul className={st.matchList}>
            {matches.map((m) => (
              <li key={m.request.requestId}>
                <span>
                  {m.request.title} <span className={st.muted}>with your "{m.song.title}"</span>
                </span>
                <Button size="md" icon={<Send size={14} />} onClick={() => setSharingReq({ request: m.request, songId: m.song.id })}>
                  Share my version
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <h3 className={st.section}>Open requests</h3>
      {sharing.boardError && <div className="notice notice-error">Could not load the board: {sharing.boardError}</div>}
      {!sharing.board && !sharing.boardError && <p className={st.muted}>Loading…</p>}
      {sharing.board && open.length === 0 && <p className={st.muted}>No open requests right now.</p>}
      <ul className={st.list}>
        {open.map((r) => (
          <li key={r.requestId}>
            <Card className={st.reqCard}>
              <div className={st.grow}>
                <p className={st.cardTitle}>
                  {r.title} <span className={st.muted}>by {r.artist}</span>
                </p>
                <div className={st.meta}>
                  <Pill>{PART_LABELS[r.part] ?? r.part}</Pill>
                  <Pill icon={<Users size={13} />}>
                    {r.memberCount} {r.memberCount === 1 ? "person" : "people"}
                  </Pill>
                  {ageText(r.openedAt) && <span className={st.muted}>{ageText(r.openedAt)}</span>}
                  {r.youtubeUrl && (
                    <a href={r.youtubeUrl} target="_blank" rel="noreferrer noopener" className={st.link}>
                      <ExternalLink size={13} /> YouTube
                    </a>
                  )}
                </div>
                {r.note && <p className={st.muted}>"{r.note}"{r.displayName ? ` (${r.displayName})` : ""}</p>}
              </div>
              <div className={st.row}>
                {!mineIds.has(r.requestId) && (
                  <Button icon={<Send size={14} />} onClick={() => setSharingReq({ request: r })}>
                    Share my version
                  </Button>
                )}
                <Button variant="ghost" icon={<Flag size={14} />} onClick={() => setReporting(r)} aria-label={`Report ${r.title}`}>
                  Report
                </Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>

      {asking !== null && (
        <AskDialog
          initialTitle={asking}
          onClose={() => setAsking(null)}
          onDone={() => {
            setAsking(null);
            onAskDone();
          }}
        />
      )}
      {sharingReq && <ShareVersionDialog request={sharingReq.request} songs={songs} initialSongId={sharingReq.songId} settings={settings} onClose={() => setSharingReq(null)} />}
      {reporting && <ReportDialog request={reporting} onClose={() => setReporting(null)} />}
    </div>
  );
}

function ReportDialog({ request, onClose }: { request: BoardRequest; onClose: () => void }) {
  const { deps } = useSharing();
  const { toast } = useShell();
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title="Report this request" onClose={onClose}>
      <p className={st.muted}>
        {request.title} by {request.artist}. The owner reviews reports and can remove the request.
      </p>
      <label className={st.form}>
        What is wrong with it?
        <textarea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className={st.actions}>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          disabled={busy || !reason.trim()}
          onClick={() => {
            setBusy(true);
            postReport(deps, request.requestId, reason).then(
              () => {
                toast("Report sent. Thank you.");
                onClose();
              },
              (e) => {
                setBusy(false);
                toast(e instanceof Error ? e.message : String(e), "error");
              },
            );
          }}
        >
          Send report
        </Button>
      </div>
    </Dialog>
  );
}

function ShareVersionDialog({
  request,
  songs,
  initialSongId,
  settings,
  onClose,
}: {
  request: BoardRequest;
  songs: SongRecord[];
  initialSongId?: string;
  settings: Settings;
  onClose: () => void;
}) {
  const { deps } = useSharing();
  const [songId, setSongId] = useState(initialSongId ?? songs[0]?.id ?? "");
  const [showName, setShowName] = useState(false);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  const record = songs.find((s) => s.id === songId);
  const parsed = useMemo(() => (record ? parse(record.text) : null), [record]);

  async function send() {
    if (!record) return;
    setBusy(true);
    setError(null);
    try {
      setSent(await postShare(deps, request, record.text, { displayName: showName ? name : "", note }));
    } catch (e) {
      setError(e instanceof ReplyTooLargeError ? e.message : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (sent !== null) {
    return (
      <Dialog title="Sent" onClose={onClose}>
        <p>
          Sent to {sent} {sent === 1 ? "person" : "people"}. Thank you for sharing.
        </p>
        <div className={st.actions}>
          <Button variant="primary" onClick={onClose}>
            Done
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title={`Share my version of "${request.title}"`} onClose={onClose} wide>
      {songs.length === 0 ? (
        <p className={st.muted}>You have no songs yet. Add one first, then come back.</p>
      ) : (
        <>
          <label className={st.form}>
            Song to send
            <select value={songId} onChange={(e) => setSongId(e.target.value)}>
              {songs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title}
                </option>
              ))}
            </select>
          </label>
          <p className={st.muted}>This is exactly what gets sent, encrypted for {request.memberCount} {request.memberCount === 1 ? "person" : "people"}. You never see who they are.</p>
          {parsed?.ok ? <SongPreview song={parsed.song} settings={settings} compact /> : <div className="notice notice-error">This song has errors and cannot be sent.</div>}
          <form
            className={st.form}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label className={st.check}>
              <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Show my name
            </label>
            {showName && (
              <label>
                Name
                <input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
            )}
            <label>
              Note (optional)
              <textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </label>
            {error && <div className="notice notice-error">{error}</div>}
            <div className={st.actions}>
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" type="submit" icon={<Send size={14} />} disabled={busy || !parsed?.ok}>
                {busy ? "Sending…" : "Send"}
              </Button>
            </div>
          </form>
        </>
      )}
    </Dialog>
  );
}

function MyRequests({
  storage,
  settings,
  focusRequestId,
  onChanged,
  onOpenSong,
}: {
  storage: StorageAdapter;
  settings: Settings;
  focusRequestId?: string;
  onChanged: () => void;
  onOpenSong: (id: string) => void;
}) {
  const sharing = useSharing();
  const { toast } = useShell();
  const [openId, setOpenId] = useState<string | null>(focusRequestId ?? null);
  const [hiddenNow, setHiddenNow] = useState<string[]>([]);

  useEffect(() => {
    if (openId) sharing.markSeen(openId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openId, sharing.replies]);

  if (sharing.myRequests.length === 0) return null;

  const repliesFor = (id: string) => sharing.replies.filter((r) => r.requestId === id && !hiddenNow.includes(r.replyId));

  async function close(r: MyRequest) {
    try {
      await postCloseRequest(sharing.deps, r.requestId);
      await sharing.refresh();
      toast("Request closed.");
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  return (
    <>
      <h3 className={st.section}>My requests</h3>
      <ul className={st.list}>
        {sharing.myRequests.map((r) => {
          const replies = repliesFor(r.requestId);
          const status = r.closed ? "Closed" : replies.length > 0 ? `${replies.length} ${replies.length === 1 ? "reply" : "replies"}` : "Waiting";
          const expanded = openId === r.requestId;
          return (
            <li key={r.requestId}>
              <Card className={st.reqCard}>
                <div className={st.rowSpread}>
                  <div className={st.grow}>
                    <p className={st.cardTitle}>
                      {r.title} <span className={st.muted}>by {r.artist}</span>
                    </p>
                  </div>
                  <Pill className={replies.length > 0 && !r.closed ? st.badge : undefined}>{status}</Pill>
                  {replies.length > 0 && (
                    <Button onClick={() => setOpenId(expanded ? null : r.requestId)} aria-expanded={expanded}>
                      {expanded ? "Hide replies" : "View replies"}
                    </Button>
                  )}
                  {!r.closed && r.closeSecret && (
                    <Button variant="ghost" onClick={() => void close(r)}>
                      Close request
                    </Button>
                  )}
                </div>
                {expanded && (
                  <div className={st.replies}>
                    {replies.map((rep) => (
                      <ReplyCard
                        key={rep.replyId}
                        reply={rep}
                        request={r}
                        settings={settings}
                        onHide={async () => {
                          await hideReply(rep.replyId);
                          setHiddenNow((h) => [...h, rep.replyId]);
                        }}
                        onAdd={async () => {
                          const rec = await storage.saveSong(rep.payload.songText);
                          onChanged();
                          toast("Added to your songs.");
                          onOpenSong(rec.id);
                        }}
                      />
                    ))}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function ReplyCard({
  reply,
  request,
  settings,
  onHide,
  onAdd,
}: {
  reply: MyReply;
  request: MyRequest;
  settings: Settings;
  onHide: () => Promise<void>;
  onAdd: () => Promise<void>;
}) {
  const [video, setVideo] = useState<Song | null>(null);
  const videoId = request.youtubeUrl ? parseYouTubeId(request.youtubeUrl) : null;
  return (
    <div className={st.reply}>
      <p className={st.muted}>
        {reply.payload.displayName ? `From ${reply.payload.displayName}` : "From someone who chose not to share their name"}
        {reply.payload.note ? `: "${reply.payload.note}"` : ""}
      </p>
      <SongPreview
        song={reply.song}
        settings={settings}
        compact
        actions={
          videoId && request.youtubeUrl ? (
            <Button
              icon={<Video size={15} />}
              onClick={() => setVideo({ ...reply.song, header: { ...reply.song.header, youtube: { url: request.youtubeUrl!, videoId, offsetSec: 0 } } })}
            >
              Play with video
            </Button>
          ) : null
        }
      />
      <div className={st.row}>
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => void onAdd()}>
          Add to my songs
        </Button>
        <Button variant="ghost" icon={<EyeOff size={15} />} onClick={() => void onHide()}>
          Hide
        </Button>
      </div>
      {video && (
        <Dialog title={`${video.header.title} with video`} onClose={() => setVideo(null)} wide>
          <PracticeArea
            song={video}
            settings={{ ...settings, micEnabled: false }}
            onOffsetNudge={(d) => setVideo((v) => (v?.header.youtube ? withYoutubeOffset(v, v.header.youtube.offsetSec + d / 1000) : v))}
            onSetBar1Here={(s) => setVideo((v) => (v?.header.youtube ? withYoutubeOffset(v, s) : v))}
            onSongBpmChange={(bpm) => setVideo((v) => (v ? withSongBpm(v, bpm) : v))}
          />
        </Dialog>
      )}
    </div>
  );
}
