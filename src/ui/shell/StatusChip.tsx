import type { ReactNode } from "react";
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

export function ChipRow({ children }: { children: ReactNode }) {
  return <div className={styles.chips}>{children}</div>;
}
