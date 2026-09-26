// Small form controls for the revamp: segmented control and number stepper.

import { useState, type ReactNode } from "react";
import { Minus, Plus } from "lucide-react";
import styles from "./Controls.module.css";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>{label}</span>
      {children}
    </div>
  );
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className={styles.segmented} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={`${styles.segment}${o.value === value ? ` ${styles.segmentOn}` : ""}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
}: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  label: string;
}) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  // Typing edits a draft; it is applied (clamped) on Enter/blur so partial
  // input like "1" on the way to "112" never takes effect.
  const [draft, setDraft] = useState<string | null>(null);
  function commit() {
    if (draft === null) return;
    const n = Number(draft);
    if (draft !== "" && Number.isFinite(n)) onChange(clamp(n));
    setDraft(null);
  }
  return (
    <div className={styles.stepper}>
      <button type="button" className={styles.stepBtn} onClick={() => onChange(clamp(value - step))} aria-label={`Decrease ${label}`} disabled={value <= min}>
        <Minus size={14} />
      </button>
      <input
        type="text"
        inputMode="numeric"
        aria-label={label}
        value={draft ?? String(value)}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value.replace(/[^0-9]/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
      <button type="button" className={styles.stepBtn} onClick={() => onChange(clamp(value + step))} aria-label={`Increase ${label}`} disabled={value >= max}>
        <Plus size={14} />
      </button>
    </div>
  );
}
