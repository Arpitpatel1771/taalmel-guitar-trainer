// App-wide shell services: toasts and cross-screen navigation shortcuts, so
// deep components (e.g. the practice area's status chips) don't need props
// threaded through every screen.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LevelSource } from "../../audio";
import { X } from "lucide-react";
import styles from "./Shell.module.css";

export type ToastKind = "success" | "info" | "error";

interface Toast {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ShellServices {
  /** Transient message. Errors stay until dismissed (spec 13: never swallowed). */
  toast: (text: string, kind?: ToastKind) => void;
  openCalibration: () => void;
}

const ShellContext = createContext<ShellServices>({
  toast: () => {},
  openCalibration: () => {},
});

export function useShell(): ShellServices {
  return useContext(ShellContext);
}

// ---- Status slot: where ChipRow renders (top-right of the screen, spec 3.3) ----

const StatusSlotContext = createContext<{ slot: HTMLElement | null; setSlot: (el: HTMLElement | null) => void }>({
  slot: null,
  setSlot: () => {},
});

export function useStatusSlot() {
  return useContext(StatusSlotContext);
}

// ---- Active microphones: screens that hold a mic register it so the pocket can show its level ----

interface MicRegistry {
  sources: Record<string, LevelSource>;
  setSource: (id: string, source: LevelSource | null) => void;
}

const MicContext = createContext<MicRegistry>({ sources: {}, setSource: () => {} });

export function useMicRegistry(): MicRegistry {
  return useContext(MicContext);
}

// ---- Practice view info: lets the pocket mirror the song tempo ----

export interface PracticeInfo {
  /** Playing tempo in bpm (the practice tempo). */
  bpm: number;
  /** True when the YouTube video is the clock (no metronome). */
  videoClock: boolean;
}

const PracticeContext = createContext<{ info: PracticeInfo | null; setInfo: (i: PracticeInfo | null) => void }>({
  info: null,
  setInfo: () => {},
});

export function usePracticeInfo(): PracticeInfo | null {
  return useContext(PracticeContext).info;
}

/** The practice view calls this so the pocket shows the song's tempo and "Record this take". */
export function useRegisterPractice(bpm: number, videoClock: boolean): void {
  const { setInfo } = useContext(PracticeContext);
  useEffect(() => {
    setInfo({ bpm, videoClock });
    return () => setInfo(null);
  }, [bpm, videoClock, setInfo]);
}

/** Registers `source` (an open mic stream or node) under `id` while it is non-null. */
export function useShellMic(id: string, source: LevelSource | null): void {
  const { setSource } = useContext(MicContext);
  useEffect(() => {
    setSource(id, source);
    return () => setSource(id, null);
  }, [id, source, setSource]);
}

const TOAST_MS = 3000;

export function ShellProvider({ children, openCalibration }: { children: ReactNode; openCalibration: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [sources, setSources] = useState<Record<string, LevelSource>>({});
  const setSource = useCallback((id: string, source: LevelSource | null) => {
    setSources((cur) => {
      if (source === null) {
        if (!(id in cur)) return cur;
        const { [id]: _gone, ...rest } = cur;
        return rest;
      }
      return cur[id] === source ? cur : { ...cur, [id]: source };
    });
  }, []);
  const [practiceInfo, setPracticeInfo] = useState<PracticeInfo | null>(null);
  const practiceValue = useMemo(() => ({ info: practiceInfo, setInfo: setPracticeInfo }), [practiceInfo]);
  const statusValue = useMemo(() => ({ slot, setSlot }), [slot]);
  const micValue = useMemo(() => ({ sources, setSource }), [sources, setSource]);
  const nextId = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (text: string, kind: ToastKind = "success") => {
      const id = nextId.current++;
      setToasts((list) => [...list, { id, kind, text }]);
      if (kind !== "error") window.setTimeout(() => dismiss(id), TOAST_MS);
    },
    [dismiss],
  );

  const services = useMemo(() => ({ toast, openCalibration }), [toast, openCalibration]);
  const kindClass: Record<ToastKind, string> = {
    success: styles.toastSuccess,
    info: styles.toastInfo,
    error: styles.toastError,
  };

  return (
    <ShellContext.Provider value={services}>
      <StatusSlotContext.Provider value={statusValue}>
      <MicContext.Provider value={micValue}>
      <PracticeContext.Provider value={practiceValue}>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`${styles.toast} ${kindClass[t.kind]}`}>
            <span className={styles.toastText}>{t.text}</span>
            <button className={styles.toastClose} onClick={() => dismiss(t.id)} aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
      </PracticeContext.Provider>
      </MicContext.Provider>
      </StatusSlotContext.Provider>
    </ShellContext.Provider>
  );
}
