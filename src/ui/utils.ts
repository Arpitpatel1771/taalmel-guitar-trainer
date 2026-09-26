// Small UI-only helpers (debouncing for relayout/live-parse, per spec 8.1 and
// 11.1 step 7).

import { useEffect, useState } from "react";

export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

export function debounce<Args extends unknown[]>(fn: (...args: Args) => void, delayMs: number): (...args: Args) => void {
  let handle: number | null = null;
  return (...args: Args) => {
    if (handle !== null) window.clearTimeout(handle);
    handle = window.setTimeout(() => fn(...args), delayMs);
  };
}

/** Character offset of the start of a 1-based line number in `text`. */
export function offsetOfLine(text: string, line: number): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < line - 1 && i < lines.length; i++) {
    offset += lines[i].length + 1;
  }
  return offset;
}

/** Copies text to the clipboard; returns false instead of throwing. */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
