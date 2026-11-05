// Settings storage (spec 11.4): a single record in the `settings` store keyed
// by the string "settings", merged with `DEFAULT_SETTINGS` on load so newly
// added fields never come back `undefined` for an older stored record.

import type { Settings } from "../model/index.js";
import { ACCENT_IDS, DEFAULT_SETTINGS, THEME_PREFS } from "../model/index.js";
import { SETTINGS_KEY, SETTINGS_STORE, openDb, reqToPromise, txDone } from "./db.js";
import { emitStorageChange, type WriteOptions } from "./changes.js";

/** Only known lanes survive: the teacher lane was removed (specs/5-11-capo.md),
 * so a stored or synced `lanes.teacher` is dropped. */
export function normalizeLanes(lanes: Partial<Settings["lanes"]> | undefined): Settings["lanes"] {
  return {
    tab: lanes?.tab ?? DEFAULT_SETTINGS.lanes.tab,
    letter: lanes?.letter ?? DEFAULT_SETTINGS.lanes.letter,
  };
}

function mergeWithDefaults(stored: Partial<Settings> | undefined): Settings {
  if (!stored) return { ...DEFAULT_SETTINGS };
  // Drop stale fields no longer part of Settings (e.g. `accidentals`, removed once
  // letter spelling became per-note metadata instead of a global user setting) so
  // an old stored record does not resurrect them.
  const { accidentals: _accidentals, ...rest } = stored as Partial<Settings> & {
    accidentals?: unknown;
  };
  return {
    ...DEFAULT_SETTINGS,
    ...rest,
    // Unknown values (a newer app version, hand-edited data) fall back to defaults.
    theme: THEME_PREFS.includes(rest.theme as never) ? (rest.theme as Settings["theme"]) : DEFAULT_SETTINGS.theme,
    accent: ACCENT_IDS.includes(rest.accent as never) ? (rest.accent as Settings["accent"]) : DEFAULT_SETTINGS.accent,
    lanes: normalizeLanes(rest.lanes),
    restBars: ([0, 1, 2, 4] as const).includes(rest.restBars as never) ? (rest.restBars as Settings["restBars"]) : DEFAULT_SETTINGS.restBars,
    tiers: { ...DEFAULT_SETTINGS.tiers, ...(rest.tiers ?? {}) },
    chordMarks: { ...(rest.chordMarks ?? {}) },
    chordView: { ...DEFAULT_SETTINGS.chordView, ...(rest.chordView ?? {}) },
    chordStats: { changes: { ...(rest.chordStats?.changes ?? {}) }, quiz: { ...(rest.chordStats?.quiz ?? {}) } },
  };
}

export async function loadSettings(): Promise<Settings> {
  const db = await openDb();
  const tx = db.transaction(SETTINGS_STORE, "readonly");
  const stored = (await reqToPromise(tx.objectStore(SETTINGS_STORE).get(SETTINGS_KEY))) as
    | Partial<Settings>
    | undefined;
  return mergeWithDefaults(stored);
}

export async function saveSettings(settings: Settings, opts?: WriteOptions): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SETTINGS_STORE, "readwrite");
  tx.objectStore(SETTINGS_STORE).put({ ...settings, lanes: normalizeLanes(settings.lanes) }, SETTINGS_KEY);
  await txDone(tx);
  emitStorageChange({ kind: "settings", op: "upsert" }, opts);
}

/** Requests persistent storage (spec 11.4: called on first run). Returns
 * `false` (rather than throwing) if the API is unavailable or the browser
 * denies the request - this is a permission outcome, not a storage error. */
export async function requestPersist(): Promise<boolean> {
  if (typeof navigator === "undefined" || !navigator.storage?.persist) return false;
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
