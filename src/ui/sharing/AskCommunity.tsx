// "Ask the community" flow (spec 3.5): form, duplicate check against the board
// (join instead of a duplicate), then a Drive nudge so replies are not lost.

import { useState } from "react";
import { Users } from "lucide-react";
import {
  MAX_NOTE_LENGTH,
  REQUEST_PARTS,
  RequestValidationError,
  duplicatesOf,
  postJoinRequest,
  postOpenRequest,
  validateRequestInput,
  type BoardRequest,
  type RequestPart,
} from "./deps";
import { Button } from "../components/kit";
import { Dialog } from "./Dialog";
import { useSharing } from "./SharingContext";
import st from "./sharing.module.css";

const PART_LABELS: Record<RequestPart, string> = { whole: "Whole song", solo: "Solo", intro: "Intro", riff: "Riff", other: "Other part" };

/** The button that starts the flow. */
export function Ask({ onAsk, label = "Ask the community" }: { onAsk: () => void; label?: string }) {
  return (
    <Button variant="primary" icon={<Users size={15} />} onClick={onAsk}>
      {label}
    </Button>
  );
}

export function NotSetUp() {
  return (
    <div className={st.notSet}>
      <p className={st.cardTitle}>Not set up</p>
      <p className={st.muted}>Song requests need a few settings that have not been added to this copy of Taalmel. The open library and share links still work.</p>
    </div>
  );
}

export function AskDialog({ initialTitle = "", onClose, onDone }: { initialTitle?: string; onClose: () => void; onDone: () => void }) {
  const sharing = useSharing();
  const [title, setTitle] = useState(initialTitle);
  const [artist, setArtist] = useState("");
  const [part, setPart] = useState<RequestPart>("whole");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [note, setNote] = useState("");
  const [showName, setShowName] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dupes, setDupes] = useState<BoardRequest[] | null>(null);
  const [sent, setSent] = useState<"open" | "join" | null>(null);

  const input = { title, artist, part, youtubeUrl, note, displayName: showName ? name : "" };

  async function submit(skipDupes = false) {
    setError(null);
    try {
      validateRequestInput(input);
    } catch (e) {
      setError(e instanceof RequestValidationError ? e.message : String(e));
      return;
    }
    setBusy(true);
    try {
      if (!skipDupes) {
        const board = await sharing.refreshBoard();
        const found = duplicatesOf(board, { title, artist }).map((d) => d.request);
        if (found.length > 0) {
          setDupes(found);
          return;
        }
      }
      await postOpenRequest(sharing.deps, input);
      await sharing.refresh();
      setSent("open");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function join(request: BoardRequest) {
    setBusy(true);
    try {
      await postJoinRequest(sharing.deps, request, showName ? name : "");
      await sharing.refresh();
      setSent("join");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!sharing.configured) {
    return (
      <Dialog title="Ask the community" onClose={onClose}>
        <NotSetUp />
      </Dialog>
    );
  }

  if (sent) {
    return (
      <Dialog title={sent === "join" ? "You are on the request" : "Request sent"} onClose={onDone}>
        <p>
          {sent === "join" ? "You will get a reply when someone shares their version." : "It shows on the board once Google refreshes it, usually within a few minutes."} Replies
          appear under Requests, and on Home.
        </p>
        {!sharing.driveConnected && sharing.driveConfigured && (
          <div className={st.nudgeBox}>
            <p>Connect Google Drive so you don't lose replies if you clear this browser or switch device.</p>
            <Button onClick={() => void sharing.connectDrive()}>Connect Google Drive</Button>
          </div>
        )}
        <div className={st.actions}>
          <Button variant="primary" onClick={onDone}>
            See my requests
          </Button>
        </div>
      </Dialog>
    );
  }

  if (dupes) {
    return (
      <Dialog title="Someone already asked" onClose={onClose}>
        {dupes.slice(0, 3).map((d) => (
          <div key={d.requestId} className={st.dupe}>
            <div>
              <p className={st.cardTitle}>
                {d.title} <span className={st.muted}>by {d.artist}</span>
              </p>
              <p className={st.muted}>
                {d.memberCount} {d.memberCount === 1 ? "person" : "people"} already asked for this. Add yourself?
              </p>
            </div>
            <Button variant="primary" disabled={busy} onClick={() => void join(d)}>
              Add me
            </Button>
          </div>
        ))}
        {error && <div className="notice notice-error">{error}</div>}
        <div className={st.actions}>
          <Button variant="ghost" onClick={() => setDupes(null)}>
            Back
          </Button>
          <Button disabled={busy} onClick={() => void submit(true)}>
            Ask separately
          </Button>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog title="Ask the community" onClose={onClose}>
      <p className={st.muted}>Anyone who has this song can send you their version. The request is public (title, artist, your note); replies are encrypted so only you can open them.</p>
      <form
        className={st.form}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
        </label>
        <label>
          Artist
          <input value={artist} onChange={(e) => setArtist(e.target.value)} />
        </label>
        <label>
          Part
          <select value={part} onChange={(e) => setPart(e.target.value as RequestPart)}>
            {REQUEST_PARTS.map((p) => (
              <option key={p} value={p}>
                {PART_LABELS[p]}
              </option>
            ))}
          </select>
        </label>
        <label>
          YouTube link (optional)
          <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://youtu.be/..." />
        </label>
        <label>
          Note (optional)
          <textarea value={note} maxLength={MAX_NOTE_LENGTH} rows={2} onChange={(e) => setNote(e.target.value)} />
        </label>
        <label className={st.check}>
          <input type="checkbox" checked={showName} onChange={(e) => setShowName(e.target.checked)} /> Show my name
        </label>
        {showName && (
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
        )}
        {error && <div className="notice notice-error">{error}</div>}
        <div className={st.actions}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? "Sending…" : "Send request"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
