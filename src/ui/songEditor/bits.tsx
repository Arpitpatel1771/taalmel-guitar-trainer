// Small shared pieces of the song editor screen.

import { useEffect, useRef, useState, type ReactNode } from "react";
import s from "./songEditor.module.css";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

/** Text that is edited in place and committed on Enter or when it loses focus. */
export function EditableText({
  value,
  onCommit,
  label,
  placeholder,
  className,
  inputMode,
}: {
  value: string;
  onCommit: (v: string) => void;
  label: string;
  placeholder?: string;
  className?: string;
  inputMode?: "text" | "numeric" | "decimal";
}) {
  const [text, setText] = useState(value);
  const editing = useRef(false);
  useEffect(() => {
    if (!editing.current) setText(value);
  }, [value]);
  const commit = (): void => {
    editing.current = false;
    if (text !== value) onCommit(text);
    else setText(value);
  };
  return (
    <input
      className={className}
      value={text}
      aria-label={label}
      placeholder={placeholder}
      inputMode={inputMode}
      onFocus={() => (editing.current = true)}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setText(value);
          editing.current = false;
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

export function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className={s.group}>
      <div className={s.groupTitle}>{title}</div>
      {children}
    </div>
  );
}

/** A square icon button with an accessible name. */
export function IconButton({
  label,
  onClick,
  disabled,
  title,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
  pressed?: boolean;
}) {
  return (
    <button type="button" className={s.iconBtn} aria-label={label} title={title ?? label} disabled={disabled} aria-pressed={pressed} onClick={onClick}>
      {children}
    </button>
  );
}

/** A small toggle button (pressed state in the accent tint). */
export function Toggle({
  on,
  onClick,
  children,
  title,
  disabled,
  danger,
}: {
  on: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button type="button" className={cx(s.toggle, on && s.toggleOn, danger && s.toggleDanger)} aria-pressed={on} title={title} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}
