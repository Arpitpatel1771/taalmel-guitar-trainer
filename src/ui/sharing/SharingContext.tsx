// App-wide sharing state: the request board, this device's requests and
// replies, the 10-minute reply poll, the daily Home nudge and the private-key
// backup in synced settings (specs/5-11-shared-library.md 3.2, 3.5, 3.6).

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Settings } from "../../model";
import {
  fetchBoard,
  fetchMyReplies,
  getOrCreateIdentity,
  getSharingConfig,
  httpTransport,
  importPrivateKeyBackup,
  listIdentities,
  listMyRequests,
  matchRequestsToSongs,
  openRequests,
  type BoardRequest,
  type MyReply,
  type MyRequest,
  type SharingDeps,
} from "../../sharing";
import { useDriveSync } from "../../drive/useDriveSync";
import type { StorageAdapter } from "../storageTypes";

export const POLL_MS = 10 * 60 * 1000;
const SEEN_KEY = "taalmel.sharing.seenReplies";
const NUDGE_KEY = "taalmel.sharing.nudgeDay";

function defaultDeps(): SharingDeps {
  return { transport: httpTransport, config: getSharingConfig() };
}

function configuredFor(deps: SharingDeps): boolean {
  const c = deps.config;
  return Boolean(c.requestsForm && c.boardCsv && c.repliesForm && c.repliesCsv && c.reportForm);
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable: nudges just repeat
  }
}

export interface SharingValue {
  deps: SharingDeps;
  configured: boolean;
  driveConnected: boolean;
  driveConfigured: boolean;
  connectDrive: () => Promise<void>;
  board: BoardRequest[] | null;
  boardError: string | null;
  refreshBoard: () => Promise<BoardRequest[]>;
  myRequests: MyRequest[];
  replies: MyReply[];
  /** Replies whose request the user has not opened yet (Home card). */
  unseenReplies: MyReply[];
  markSeen: (requestId: string) => void;
  refresh: () => Promise<void>;
  /** "You have songs for N requests", at most once a day. */
  nudge: { count: number } | null;
  dismissNudge: () => void;
}

const Ctx = createContext<SharingValue | null>(null);

export function useSharing(): SharingValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useSharing needs a SharingProvider");
  return v;
}

export function SharingProvider({
  storage,
  settings,
  onSettingsChange,
  children,
}: {
  storage: StorageAdapter;
  settings: Settings;
  onSettingsChange: (next: Settings) => void;
  children: ReactNode;
}) {
  const deps = useMemo(defaultDeps, []);
  const configured = useMemo(() => configuredFor(deps), [deps]);
  const drive = useDriveSync();
  const driveConnected = drive.status.state !== "disconnected";

  const [board, setBoard] = useState<BoardRequest[] | null>(null);
  const [boardError, setBoardError] = useState<string | null>(null);
  const [myRequests, setMyRequests] = useState<MyRequest[]>([]);
  const [replies, setReplies] = useState<MyReply[]>([]);
  const [seen, setSeen] = useState<string[]>(() => readJson<string[]>(SEEN_KEY, []));
  const [nudge, setNudge] = useState<{ count: number } | null>(null);
  const nudgeChecked = useRef(false);

  const refreshBoard = useCallback(async () => {
    try {
      const b = await fetchBoard(deps);
      setBoard(b);
      setBoardError(null);
      return b;
    } catch (err) {
      setBoardError(err instanceof Error ? err.message : String(err));
      return [];
    }
  }, [deps]);

  const refresh = useCallback(async () => {
    try {
      setMyRequests(await listMyRequests());
    } catch {
      // IndexedDB unavailable
    }
    if (!configured) return;
    try {
      setReplies(await fetchMyReplies(deps));
    } catch {
      // offline: keep what we have
    }
    const b = await refreshBoard();
    if (!nudgeChecked.current) {
      nudgeChecked.current = true;
      const today = new Date().toISOString().slice(0, 10);
      if (readJson<string>(NUDGE_KEY, "") !== today) {
        try {
          const songs = await storage.listSongs();
          const mine = new Set((await listMyRequests()).map((r) => r.requestId));
          const count = matchRequestsToSongs(openRequests(b).filter((r) => !mine.has(r.requestId)), songs).length;
          if (count > 0) {
            writeJson(NUDGE_KEY, today);
            setNudge({ count });
          }
        } catch {
          // ignore
        }
      }
    }
  }, [configured, deps, refreshBoard, storage]);

  useEffect(() => {
    void refresh();
    const id = window.setInterval(() => void refresh(), POLL_MS);
    return () => window.clearInterval(id);
  }, [refresh]);

  // Key backup (spec 3.2): restore a synced key, or back up ours once Drive is connected.
  const backup = settings.sharingKeyBackup;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const requestCount = myRequests.length;
  useEffect(() => {
    let off = false;
    void (async () => {
      try {
        if (backup) {
          await importPrivateKeyBackup(backup);
          return;
        }
        if (!driveConnected || (await listIdentities()).length === 0) return;
        const jwk = (await getOrCreateIdentity()).privateKeyJwk;
        if (!off) onSettingsChange({ ...settingsRef.current, sharingKeyBackup: jwk });
      } catch {
        // an invalid backup is ignored
      }
    })();
    return () => {
      off = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [backup, driveConnected, requestCount]);

  const unseenReplies = useMemo(() => {
    const open = new Set(myRequests.filter((r) => !r.closed).map((r) => r.requestId));
    return replies.filter((r) => open.has(r.requestId) && !seen.includes(r.replyId));
  }, [replies, myRequests, seen]);

  const markSeen = useCallback(
    (requestId: string) => {
      setSeen((prev) => {
        const add = replies.filter((r) => r.requestId === requestId).map((r) => r.replyId);
        const next = [...new Set([...prev, ...add])];
        writeJson(SEEN_KEY, next);
        return next;
      });
    },
    [replies],
  );

  const value: SharingValue = {
    deps,
    configured,
    driveConnected,
    driveConfigured: drive.configured,
    connectDrive: drive.connect,
    board,
    boardError,
    refreshBoard,
    myRequests,
    replies,
    unseenReplies,
    markSeen,
    refresh,
    nudge,
    dismissNudge: () => setNudge(null),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
