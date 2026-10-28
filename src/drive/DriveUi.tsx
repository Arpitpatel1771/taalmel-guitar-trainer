// Drive UI pieces that live outside Settings: sidebar chip, song conflict dialog
// and remote-delete confirmation.

import { useEffect } from "react";
import { useShell } from "../ui/shell/AppShellContext";
import { StatusChip } from "../ui/shell/StatusChip";
import type { SongConflict } from "./engine";
import { chipFor } from "./syncUi";
import { useDriveSync } from "./useDriveSync";
import st from "./DriveUi.module.css";

/** Sidebar chip; renders nothing when Drive is disconnected. */
export function DriveChip() {
  const { status, connect, syncNow, setConflictsOpen } = useDriveSync();
  const { toast } = useShell();
  const chip = chipFor(status);
  if (!chip) return null;
  const run = (p: Promise<void>) => p.catch((err) => toast(err instanceof Error ? err.message : String(err), "error"));
  return (
    <StatusChip
      tone={chip.tone}
      pulse={chip.pulse}
      title={status.lastSyncAt ? `Last synced ${new Date(status.lastSyncAt).toLocaleTimeString()}` : "Google Drive sync"}
      onClick={() => {
        if (chip.action === "connect") void run(connect());
        else if (chip.action === "conflicts") setConflictsOpen(true);
        else void run(syncNow());
      }}
    >
      {chip.text}
    </StatusChip>
  );
}

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : "unknown";
}

function ConflictDialog({ conflict, index, total }: { conflict: SongConflict; index: number; total: number }) {
  const { resolveConflict } = useDriveSync();
  const { toast } = useShell();
  async function choose(choice: "local" | "remote" | "both") {
    try {
      await resolveConflict(conflict.songId, choice);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), "error");
    }
  }
  return (
    <div className="modal-overlay">
      <div className={`modal ${st.wide}`} role="dialog" aria-label="Song conflict">
        <h3>
          “{conflict.localTitle}” changed on this device and in Drive
          {total > 1 ? ` (${index + 1} of ${total})` : ""}
        </h3>
        <div className={st.cols}>
          <div className={st.col}>
            <span className={st.colTitle}>This device: {conflict.localTitle}</span>
            <span className={st.colWhen}>Changed {when(conflict.localUpdatedAt)}</span>
            <pre className={st.text}>{conflict.localText}</pre>
          </div>
          <div className={st.col}>
            <span className={st.colTitle}>Drive: {conflict.remoteTitle}</span>
            <span className={st.colWhen}>Changed {when(conflict.remoteUpdatedAt)}</span>
            <pre className={st.text}>{conflict.remoteText}</pre>
          </div>
        </div>
        <div className="modal-actions">
          <button onClick={() => void choose("local")}>Keep this device's</button>
          <button onClick={() => void choose("remote")}>Keep Drive's</button>
          <button className="btn-primary" onClick={() => void choose("both")}>
            Keep both
          </button>
        </div>
      </div>
    </div>
  );
}

/** Mounts the conflict dialog (when opened) and the remote-delete confirmation. */
export function DriveDialogs() {
  const { status, conflictsOpen, setConflictsOpen, resolveRemoteDeletes } = useDriveSync();
  const { toast } = useShell();
  const deletes = status.pendingRemoteDeletes;
  const noConflicts = status.conflicts.length === 0;
  useEffect(() => {
    if (conflictsOpen && noConflicts) setConflictsOpen(false);
  }, [conflictsOpen, noConflicts, setConflictsOpen]);

  if (deletes.length > 0) {
    const ids = deletes.map((d) => d.id);
    const answer = async (accept: boolean) => {
      try {
        await resolveRemoteDeletes(ids, accept);
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), "error");
      }
    };
    return (
      <div className="modal-overlay">
        <div className="modal" role="dialog" aria-label="Deleted in Drive">
          <h3>
            {deletes.length === 1 ? "1 item was" : `${deletes.length} items were`} deleted in Drive. Delete {deletes.length === 1 ? "it" : "them"} here too?
          </h3>
          <ul className={st.list}>
            {deletes.map((d) => (
              <li key={`${d.kind}:${d.id}`}>
                {d.title} <span className={st.colWhen}>({d.kind === "song" ? "song" : "recording"})</span>
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button onClick={() => void answer(false)}>Keep (re-upload)</button>
            <button className="btn-danger" onClick={() => void answer(true)}>
              Delete here
            </button>
          </div>
        </div>
      </div>
    );
  }

  const conflicts = status.conflicts;
  if (conflictsOpen && conflicts.length > 0) return <ConflictDialog conflict={conflicts[0]} index={0} total={conflicts.length} />;
  return null;
}
