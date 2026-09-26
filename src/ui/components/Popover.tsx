// Minimal popover: a trigger button and a floating panel that closes on
// outside click or Escape. Opens upward (it lives in the bottom dock).

import { useEffect, useRef, useState, type ReactNode } from "react";
import styles from "./TransportDock.module.css";

export function Popover({
  label,
  icon,
  children,
  placement = "up",
  iconOnly = false,
  width,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** "up" for the bottom dock, "down" for menus in page content. */
  placement?: "up" | "down";
  /** Show only the icon (label becomes the accessible name / tooltip). */
  iconOnly?: boolean;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className={styles.popoverRoot} ref={rootRef}>
      <button
        className={`${styles.ghostBtn}${open ? ` ${styles.on}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={iconOnly ? label : undefined}
        title={iconOnly ? label : undefined}
      >
        {icon}
        {!iconOnly && label}
      </button>
      {open && (
        <div
          className={`${styles.popover}${placement === "down" ? ` ${styles.popoverDown}` : ""}`}
          role="dialog"
          aria-label={label}
          style={width ? { width } : undefined}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
