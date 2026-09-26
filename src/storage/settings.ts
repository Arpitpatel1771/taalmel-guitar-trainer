// Settings storage (spec 11.4): a single record in the `settings` store keyed
// by the string "settings", merged with `DEFAULT_SETTINGS` on load so newly
// added fields never come back `undefined` for an older stored record.

import type { Settings } from "../model/index.js";
import { DEFAULT_SETTINGS } from "../model/index.js";
import { SETTINGS_KEY, SETTINGS_STORE, openDb, reqToPromise, txDone } from "./db.js";

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
    lanes: { ...DEFAULT_SETTINGS.lanes, ...(rest.lanes ?? {}) },
    tiers: { ...DEFAULT_SETTINGS.tiers, ...(rest.tiers ?? {}) },
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

export async function saveSettings(settings: Settings): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SETTINGS_STORE, "readwrite");
  tx.objectStore(SETTINGS_STORE).put(settings, SETTINGS_KEY);
  await txDone(tx);
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
