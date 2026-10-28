// React context for Drive sync: one SyncEngine per app, its status, and actions.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { computeClipPeaks } from "../recording";
import { RestDriveApi, type DriveApi } from "./api";
import { GisDriveAuth, type DriveAuth } from "./auth";
import { isDriveConfigured } from "./config";
import { SyncEngine, type SyncStatus, type UploadSetting } from "./engine";
import { pickDriveFiles } from "./picker";
import * as syncDb from "./syncDb";
import type { SyncStore } from "./engine";

const EMPTY_STATUS: SyncStatus = {
  state: "disconnected",
  email: null,
  lastSyncAt: null,
  conflicts: [],
  pendingRemoteDeletes: [],
  uploads: {},
  error: null,
};

export interface DriveSyncValue {
  /** Env vars are present (real Drive or dev fake mode). */
  configured: boolean;
  /** The engine is created and its stored connection has been checked. */
  ready: boolean;
  status: SyncStatus;
  uploadSetting: UploadSetting;
  conflictsOpen: boolean;
  setConflictsOpen: (open: boolean) => void;
  /** Interactive connect: call from a click. */
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  syncNow: () => Promise<void>;
  setUploadSetting: (s: UploadSetting) => Promise<void>;
  importFromDrive: () => Promise<{ songs: number; clips: number } | null>;
  resolveConflict: (songId: string, choice: "local" | "remote" | "both") => Promise<void>;
  resolveRemoteDeletes: (ids: string[], accept: boolean) => Promise<void>;
  uploadClip: (id: string) => Promise<void>;
  removeLocalMedia: (id: string) => Promise<void>;
  downloadClipMedia: (id: string, onProgress?: (fraction: number) => void) => Promise<Blob>;
}

const noop = async () => undefined;
const DriveSyncContext = createContext<DriveSyncValue>({
  configured: false,
  ready: false,
  status: EMPTY_STATUS,
  uploadSetting: "audio",
  conflictsOpen: false,
  setConflictsOpen: () => {},
  connect: noop,
  disconnect: noop,
  syncNow: noop,
  setUploadSetting: noop,
  importFromDrive: async () => null,
  resolveConflict: noop,
  resolveRemoteDeletes: noop,
  uploadClip: noop,
  removeLocalMedia: noop,
  downloadClipMedia: async () => {
    throw new Error("Drive is not configured.");
  },
});

export function useDriveSync(): DriveSyncValue {
  return useContext(DriveSyncContext);
}

declare global {
  interface Window {
    /** Dev-only: the FakeDrive instance when localStorage "taalmel.fakeDrive" is "1". */
    __taalmelFakeDrive?: unknown;
  }
}

function fakeModeRequested(): boolean {
  if (!import.meta.env.DEV) return false;
  try {
    return localStorage.getItem("taalmel.fakeDrive") === "1";
  } catch {
    return false;
  }
}

/** Duration (hidden media element) and waveform peaks for media imported from Drive. */
export async function probeMedia(blob: Blob): Promise<{ durationSec: number; peaks?: number[] }> {
  const hasVideo = blob.type.startsWith("video/");
  const durationSec = await new Promise<number>((resolve) => {
    const el = document.createElement(hasVideo ? "video" : "audio");
    const url = URL.createObjectURL(blob);
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    el.preload = "metadata";
    el.onerror = () => done(0);
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) return done(el.duration);
      // WebM from MediaRecorder reports Infinity until seeked to the end.
      el.ontimeupdate = () => done(el.duration);
      el.currentTime = 1e101;
    };
    el.src = url;
  });
  let peaks: number[] | undefined;
  try {
    peaks = await computeClipPeaks(blob, blob.type, hasVideo);
  } catch {
    // Peaks are optional; the trimmer computes them later.
  }
  return { durationSec, peaks };
}

interface Created {
  engine: SyncEngine;
  auth: DriveAuth;
  store: SyncStore;
}

async function createEngine(): Promise<Created | null> {
  // The literal DEV check must sit right here so production builds drop the fake entirely.
  if (import.meta.env.DEV && fakeModeRequested()) {
    const [{ FakeDrive }, { memorySyncStore }] = await Promise.all([import("./testing/fakeDrive"), import("./testing/memorySyncStore")]);
    const fake = new FakeDrive();
    window.__taalmelFakeDrive = fake;
    const listeners = new Set<() => void>();
    const auth: DriveAuth = {
      getToken: async () => "fake-token",
      onChange: (cb) => {
        listeners.add(cb);
        return () => listeners.delete(cb);
      },
      email: () => "dev@example.com",
      signOut: () => listeners.forEach((cb) => cb()),
    };
    const store = memorySyncStore();
    return { engine: new SyncEngine({ api: fake, auth, store, probeMedia }), auth, store };
  }
  if (!isDriveConfigured()) return null;
  const auth = new GisDriveAuth();
  const api: DriveApi = new RestDriveApi(() => auth.getToken({ interactive: false }));
  return { engine: new SyncEngine({ api, auth, probeMedia }), auth, store: syncDb };
}

export function DriveSyncProvider({ children, onError }: { children: ReactNode; onError?: (message: string) => void }) {
  const configured = isDriveConfigured() || fakeModeRequested();
  const [created, setCreated] = useState<Created | null>(null);
  const [status, setStatus] = useState<SyncStatus>(EMPTY_STATUS);
  const [conflictsOpen, setConflictsOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const lastError = useRef<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!configured) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    void (async () => {
      const c = await createEngine();
      if (cancelled || !c) return;
      setCreated(c);
      const unsub = c.engine.onStatus(setStatus);
      const stopTimers = c.engine.handleVisibilityAndTimers();
      cleanup = () => {
        unsub();
        stopTimers();
        c.engine.stop();
      };
      setStatus(c.engine.getStatus());
      try {
        // Resume only if a connection was stored before.
        if (await c.store.getMeta("conn")) await c.engine.connect({ interactive: false });
      } catch (err) {
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
      }
      if (!cancelled) {
        setStatus(c.engine.getStatus());
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [configured]);

  // One error toast per new error message.
  useEffect(() => {
    if (status.error && status.error !== lastError.current) onErrorRef.current?.(status.error);
    lastError.current = status.error;
  }, [status.error]);

  const engine = created?.engine ?? null;
  const need = useCallback(() => {
    if (!engine) throw new Error("Drive is not configured.");
    return engine;
  }, [engine]);

  const value = useMemo<DriveSyncValue>(
    () => ({
      configured,
      ready,
      status,
      uploadSetting: engine?.getUploadSetting() ?? "audio",
      conflictsOpen,
      setConflictsOpen,
      connect: () => need().connect({ interactive: true }),
      disconnect: () => need().disconnect(),
      syncNow: () => need().syncNow(),
      setUploadSetting: async (s) => {
        await need().setUploadSetting(s);
        setStatus(need().getStatus());
      },
      importFromDrive: async () => {
        const e = need();
        const token = await created!.auth.getToken({ interactive: true });
        const ids = await pickDriveFiles(token);
        if (ids.length === 0) return null;
        const r = await e.importFiles(ids);
        return { songs: r.songs.length, clips: r.clips.length };
      },
      resolveConflict: (id, choice) => need().resolveConflict(id, choice),
      resolveRemoteDeletes: (ids, accept) => need().resolveRemoteDeletes(ids, accept),
      uploadClip: (id) => need().uploadClipMedia(id),
      removeLocalMedia: (id) => need().removeLocalMedia(id),
      downloadClipMedia: (id, onProgress) => need().downloadClipMedia(id, onProgress),
    }),
    [configured, ready, status, engine, created, conflictsOpen, need],
  );

  return <DriveSyncContext.Provider value={value}>{children}</DriveSyncContext.Provider>;
}
