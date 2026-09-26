// Shared test helper: deletes the fake-indexeddb-backed `taalmel` database and
// drops the module-level connection cache, so each test starts from a clean
// database. Import "fake-indexeddb/auto" first in every test file that uses
// this (it installs the global `indexedDB`).

import { DB_NAME, _resetDbForTests } from "./db.js";

export async function resetTaalmelDb(): Promise<void> {
  _resetDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
