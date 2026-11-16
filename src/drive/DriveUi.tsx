// Drive dialogs that live outside Settings: the song conflict dialog and the remote-delete confirmation. Thin wrappers
// over the package's DriveConflictDialog / DriveDeleteConfirm, rendered in Taalmel's modal.

import type { ReactNode } from "react";
import { DriveConflictDialog, DriveDeleteConfirm } from "@arpitpatel1771/drive-sync/react";
import st from "./DriveUi.module.css";

function when(ms: number): string {
  return ms ? new Date(ms).toLocaleString() : "unknown";
}

function TaalmelModal({ title, children, wide }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay">
      <div className={`modal ${st.scope}${wide ? ` ${st.wide}` : ""}`} role="dialog" aria-label={title}>
        {children}
      </div>
    </div>
  );
}

/** Mounts the conflict dialog (when opened) and the remote-delete confirmation. */
export function DriveDialogs() {
  return (
    <>
      <DriveDeleteConfirm renderDialog={({ children }) => <TaalmelModal title="Deleted in Drive">{children}</TaalmelModal>} />
      <DriveConflictDialog
        renderDialog={({ children }) => (
          <TaalmelModal title="Song conflict" wide>
            {children}
          </TaalmelModal>
        )}
        renderVersion={(c, side) => {
          const local = side === "local";
          return (
            <>
              <span className={st.colTitle}>
                {local ? "This device" : "Drive"}: {local ? c.localTitle : c.remoteTitle}
              </span>
              <span className={st.colWhen}>Changed {when(local ? c.localUpdatedAt : c.remoteUpdatedAt)}</span>
              <pre className={st.text}>{local ? c.localText : c.remoteText}</pre>
            </>
          );
        }}
      />
    </>
  );
}
