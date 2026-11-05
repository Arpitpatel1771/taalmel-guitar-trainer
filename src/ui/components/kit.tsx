// Shared building blocks of the redesign (specs/5-11-ui-redesign.md 7): Button,
// Pill, Card, SegmentedControl, IconTile, Chip, Slider and Meter. Colours come
// only from the semantic tokens in tokens.css. Popover lives in Popover.tsx.

import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import styles from "./kit.module.css";

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "secondary" | "ghost";

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: "md" | "lg"; icon?: ReactNode }) {
  return (
    <button type={type} className={cx(styles.button, styles[variant], size === "lg" && styles.lg, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

/** Rounded surface-2 label, optionally clickable (then it is a button). */
export function Pill({
  icon,
  onClick,
  title,
  className,
  children,
}: {
  icon?: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
  children: ReactNode;
}) {
  const content = (
    <>
      {icon}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={cx(styles.pill, styles.pillBtn, className)} title={title} onClick={onClick}>
      {content}
    </button>
  ) : (
    <span className={cx(styles.pill, className)} title={title}>
      {content}
    </span>
  );
}

export function Card({ className, children, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cx(styles.card, className)} {...rest}>
      {children}
    </div>
  );
}

export function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
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
          title={o.title}
          className={cx(styles.segment, o.value === value && styles.segmentOn)}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Icon on an accent-tint square (toolbox tiles). */
export function IconTile({ children, size = 44 }: { children: ReactNode; size?: number }) {
  return (
    <span className={styles.iconTile} style={{ width: size, height: size }} aria-hidden>
      {children}
    </span>
  );
}

/** Selectable chip (section chips, filters). `on` fills with the accent. */
export function Chip({
  on = false,
  onClick,
  icon,
  children,
  title,
}: {
  on?: boolean;
  onClick?: () => void;
  icon?: ReactNode;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button type="button" className={cx(styles.chip, on && styles.chipOn)} aria-pressed={onClick ? on : undefined} title={title} onClick={onClick}>
      {icon}
      {children}
    </button>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  className,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
  label: string;
  className?: string;
}) {
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <input
      type="range"
      className={cx(styles.slider, className)}
      style={{ ["--fill" as string]: `${pct}%` }}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}

export type MeterTone = "ok" | "warn" | "off" | "neutral";

/** Level meter: `bars` of `count` lit, in a meaning colour. */
export function Meter({ bars, count = 5, tone = "ok", label }: { bars: number; count?: number; tone?: MeterTone; label?: string }) {
  return (
    <span className={cx(styles.meter, styles[`meter_${tone}`])} role="img" aria-label={label ?? `Level ${Math.round(bars)} of ${count}`}>
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className={cx(styles.bar, i < Math.round(bars) && styles.barOn)} style={{ height: 6 + i * 3 }} />
      ))}
    </span>
  );
}
