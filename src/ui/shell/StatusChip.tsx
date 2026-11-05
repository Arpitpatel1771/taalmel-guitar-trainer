import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useStatusSlot } from "./AppShellContext";
import styles from "./Shell.module.css";

export type ChipTone = "neutral" | "ok" | "info" | "warning" | "error" | "accent";

const toneClass: Record<ChipTone, string> = {
  neutral: "",
  ok: styles.chipOk,
  info: styles.chipInfo,
  warning: styles.chipWarning,
  error: styles.chipError,
  accent: styles.chipAccent,
};

/** Small pill for persistent states (mic, calibration, storage, video),
 * replacing full-width banners. Clickable when `onClick` is given. */
export function StatusChip({
  tone = "neutral",
  icon,
  pulse,
  title,
  onClick,
  children,
}: {
  tone?: ChipTone;
  icon?: ReactNode;
  pulse?: boolean;
  title?: string;
  onClick?: () => void;
  children: ReactNode;
}) {
  const className = `${styles.chip} ${toneClass[tone]}${pulse ? ` ${styles.pulse}` : ""}`;
  const content = (
    <>
      {icon ?? <span className={styles.chipDot} />}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={className} title={title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={className} title={title} style={{ display: "inline-flex", alignItems: "center" }}>
      {content}
    </span>
  );
}

/** Status chips live at the top-right of the screen (spec 3.3): rendered into
 * the shell's status slot when there is one, inline otherwise (tests). */
export function ChipRow({ children }: { children: ReactNode }) {
  const { slot } = useStatusSlot();
  const row = <div className={styles.chips}>{children}</div>;
  return slot ? createPortal(row, slot) : row;
}
