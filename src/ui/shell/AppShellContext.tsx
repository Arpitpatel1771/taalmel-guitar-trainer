// App-wide shell services: toasts and cross-screen navigation shortcuts, so
// deep components (e.g. the practice area's status chips) don't need props
// threaded through every screen.

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
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

const TOAST_MS = 3000;

export function ShellProvider({ children, openCalibration }: { children: ReactNode; openCalibration: () => void }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
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
    </ShellContext.Provider>
  );
}
