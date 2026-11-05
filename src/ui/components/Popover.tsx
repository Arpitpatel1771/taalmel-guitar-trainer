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
  trigger,
  triggerClassName,
  align = "right",
  open: openProp,
  onOpenChange,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  /** "up" for the bottom dock, "down" for menus in page content. */
  placement?: "up" | "down";
  /** Show only the icon (label becomes the accessible name / tooltip). */
  iconOnly?: boolean;
  width?: number;
  /** Custom trigger content (replaces icon and label) rendered in an unstyled button. */
  trigger?: ReactNode;
  triggerClassName?: string;
  /** Which edge of the trigger the panel lines up with. */
  align?: "left" | "right";
  /** Controlled mode (e.g. opened by a keyboard shortcut). Omit for uncontrolled. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [openState, setOpenState] = useState(false);
  const open = openProp ?? openState;
  const setOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    const next = typeof v === "function" ? v(open) : v;
    if (openProp === undefined) setOpenState(next);
    onOpenChange?.(next);
  };
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <div className={styles.popoverRoot} ref={rootRef}>
      <button
        className={trigger ? triggerClassName : `${styles.ghostBtn}${open ? ` ${styles.on}` : ""}`}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={iconOnly || trigger ? label : undefined}
        aria-label={iconOnly || trigger ? label : undefined}
      >
        {trigger ?? (
          <>
            {icon}
            {!iconOnly && label}
          </>
        )}
      </button>
      {open && (
        <div
          className={`${styles.popover}${placement === "down" ? ` ${styles.popoverDown}` : ""}`}
          role="dialog"
          aria-label={label}
          style={{ ...(width ? { width } : null), ...(align === "left" ? { left: 0, right: "auto" } : null) }}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}
