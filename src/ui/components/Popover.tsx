// Minimal popover: a trigger button and a floating panel that closes on
// outside click or Escape. Opens upward (it lives in the bottom dock).
// In the compact layout (phones, tablets) the panel opens as a bottom sheet instead.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useCompact } from "../compact";
import { BottomSheet } from "./BottomSheet";
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
  const compact = useCompact();
  // Switching layout (window resized, tablet rotated) closes it rather than turning a panel into a sheet.
  const wasCompact = useRef(compact);
  useEffect(() => {
    if (wasCompact.current === compact) return;
    wasCompact.current = compact;
    if (open) setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);

  useEffect(() => {
    // The sheet handles its own closing (and lives outside rootRef, in a portal).
    if (!open || compact) return;
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
  }, [open, compact]);
  const content = typeof children === "function" ? children(() => setOpen(false)) : children;

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
      {compact ? (
        <BottomSheet open={open} onClose={() => setOpen(false)} title={label}>
          {content}
        </BottomSheet>
      ) : open && (
        <div
          className={`${styles.popover}${placement === "down" ? ` ${styles.popoverDown}` : ""}`}
          role="dialog"
          aria-label={label}
          style={{ ...(width ? { width } : null), ...(align === "left" ? { left: 0, right: "auto" } : null) }}
        >
          {content}
        </div>
      )}
    </div>
  );
}
