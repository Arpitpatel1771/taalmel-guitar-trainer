// Compact layout detection (specs/8-11-mobile.md §1): phones and tablets get the compact layout,
// laptops keep the full one. CSS repeats COMPACT_QUERY / PHONE_QUERY verbatim in its media queries;
// React reads them here only where the structure changes (rail vs tab bar, pocket vs Tools sheet).

import { useSyncExternalStore } from "react";

export const COMPACT_QUERY = "(max-width: 899.98px), (hover: none) and (pointer: coarse)";
export const PHONE_QUERY = "(max-width: 599.98px)";

type MatchMedia = (q: string) => { matches: boolean };
type ListenableMatchMedia = (q: string) => {
  matches: boolean;
  addEventListener?: (type: "change", l: (e: { matches: boolean }) => void) => void;
  removeEventListener?: (type: "change", l: (e: { matches: boolean }) => void) => void;
};

function defaultMatchMedia(): ListenableMatchMedia | undefined {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? (q) => window.matchMedia(q) : undefined;
}

export function matchesQuery(query: string, mm: MatchMedia | undefined = defaultMatchMedia()): boolean {
  return mm ? mm(query).matches : false;
}

/** Calls `cb` whenever the query starts or stops matching (resize, rotation). Returns the unsubscribe. */
export function subscribeQuery(query: string, cb: (matches: boolean) => void, mm: ListenableMatchMedia | undefined = defaultMatchMedia()): () => void {
  if (!mm) return () => undefined;
  const list = mm(query);
  const listener = (e: { matches: boolean }) => cb(e.matches);
  list.addEventListener?.("change", listener);
  return () => list.removeEventListener?.("change", listener);
}

// One stable subscribe/read pair per query, so React doesn't re-subscribe on every render.
const stores = new Map<string, { subscribe: (onChange: () => void) => () => void; read: () => boolean }>();
function storeFor(query: string) {
  let st = stores.get(query);
  if (!st) {
    st = { subscribe: (onChange) => subscribeQuery(query, onChange), read: () => matchesQuery(query) };
    stores.set(query, st);
  }
  return st;
}

function useQuery(query: string): boolean {
  const st = storeFor(query);
  return useSyncExternalStore(st.subscribe, st.read, () => false);
}

/** True on phones and tablets (narrow, or touch-first). */
export function useCompact(): boolean {
  return useQuery(COMPACT_QUERY);
}

/** True on phone-width screens (dialogs go full-screen). */
export function usePhone(): boolean {
  return useQuery(PHONE_QUERY);
}
