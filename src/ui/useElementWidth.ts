// Tracks an element's content width via ResizeObserver, debounced 150ms
// (spec 8.1: "Relayout happens only on ... container resize (debounced
// 150ms)").

import { useCallback, useRef, useState } from "react";
import { debounce } from "./utils";

export function useElementWidth(initial = 900): [(el: HTMLElement | null) => void, number] {
  const [width, setWidth] = useState(initial);
  const roRef = useRef<ResizeObserver | null>(null);
  const setWidthDebounced = useRef(debounce((w: number) => setWidth(w), 150)).current;

  const ref = useCallback(
    (el: HTMLElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (!el) return;
      setWidthDebounced(el.clientWidth);
      const ro = new ResizeObserver((entries) => {
        for (const entry of entries) setWidthDebounced(entry.contentRect.width);
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [setWidthDebounced],
  );

  return [ref, width];
}
