// Tiny typed emitter for local data mutations. The Drive sync engine listens
// here to know what to push. Writers accept `{ silent: true }` so the engine
// can write pulled data without echoing it back.

export type StorageChange =
  | { kind: "song"; id: string; op: "upsert" | "delete" }
  | { kind: "settings"; op: "upsert" }
  | { kind: "clip"; id: string; op: "upsert" | "delete" };

/** Last-argument option accepted by every storage writer. */
export interface WriteOptions {
  silent?: true;
}

const listeners = new Set<(evt: StorageChange) => void>();

export function onStorageChange(cb: (evt: StorageChange) => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function emitStorageChange(evt: StorageChange, opts?: WriteOptions): void {
  if (opts?.silent) return;
  for (const cb of [...listeners]) {
    try {
      cb(evt);
    } catch (err) {
      console.error("storage change listener failed", err);
    }
  }
}
