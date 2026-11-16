// Modal sheet that slides up from the bottom (specs/8-11-mobile.md §3.3): what popovers, menus and the
// More / Tools panels become in the compact layout. Closes on Esc, a tap on the scrim, or a downward
// swipe on the handle; keeps focus inside while open and gives it back to the opener on close.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useCompact } from "../compact";
import styles from "./BottomSheet.module.css";

const SWIPE_CLOSE_PX = 80;

/** A downward drag longer than this closes the sheet. */
export function shouldCloseOnSwipe(dyPx: number): boolean {
  return dyPx > SWIPE_CLOSE_PX;
}

/** Open sheets, oldest first: keys (Esc, Tab) go to the top one only, so a sheet opened from a sheet
 * (e.g. the account menu inside More) closes on its own. */
const openSheets: object[] = [];
export function pushSheet(token: object): () => void {
  openSheets.push(token);
  return () => {
    const i = openSheets.lastIndexOf(token);
    if (i >= 0) openSheets.splice(i, 1);
  };
}
export function isTopSheet(token: object): boolean {
  return openSheets.length > 0 && openSheets[openSheets.length - 1] === token;
}

const FOCUSABLE = "button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const compact = useCompact();
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<{ y0: number; dy: number } | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // The layout went back to laptop (window widened) with the sheet open: don't leave an overlay behind.
  useEffect(() => {
    if (open && !compact) onCloseRef.current();
  }, [open, compact]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const sheet = sheetRef.current;
    const token = {};
    const pop = pushSheet(token);
    // Focus the sheet itself, not its first field: focusing a text input would raise the phone keyboard.
    sheet?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (!isTopSheet(token)) return;
      if (e.key === "Escape") {
        e.stopImmediatePropagation();
        onCloseRef.current();
      } else if (e.key === "Tab" && sheet) {
        const items = [...sheet.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
        if (items.length === 0) return;
        const first = items[0];
        const last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    // The sheet is modal: keys typed in it must not reach the app's window-level shortcuts (Space = play,
    // T = tuner…). React's own handlers inside the sheet run on body, before this document listener.
    const block = (e: KeyboardEvent) => {
      if (isTopSheet(token)) e.stopPropagation();
    };
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", block);
    return () => {
      pop();
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", block);
      opener?.focus?.();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;
  return createPortal(
    // Close on click (not pointerdown): closing on touch start lets the tap land on what was underneath.
    // The sheet is a portal, so stop its events reaching the opener's React parents (e.g. a song row).
    <div
      className={styles.scrim}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={sheetRef}
        className={styles.sheet}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={drag && drag.dy > 0 ? { transform: `translateY(${drag.dy}px)`, transition: "none" } : undefined}
      >
        <div
          className={styles.handleArea}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setDrag({ y0: e.clientY, dy: 0 });
          }}
          onPointerMove={(e) => drag && setDrag({ y0: drag.y0, dy: e.clientY - drag.y0 })}
          onPointerUp={() => {
            if (drag && shouldCloseOnSwipe(drag.dy)) onClose();
            setDrag(null);
          }}
          onPointerCancel={() => setDrag(null)}
        >
          <span className={styles.handle} aria-hidden="true" />
          <span className={styles.title}>{title}</span>
        </div>
        <div className={styles.body}>{children}</div>
      </div>
    </div>,
    document.body,
  );
}
