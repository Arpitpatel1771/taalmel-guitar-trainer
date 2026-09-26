import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { SONGS_STORE, openDb, reqToPromise } from "./db.js";
import { resetTaalmelDb } from "./testSetup.js";

afterEach(async () => {
  await resetTaalmelDb();
});

describe("openDb", () => {
  it("creates the songs and settings stores, with an updatedAt index on songs", async () => {
    const db = await openDb();
    expect(Array.from(db.objectStoreNames).sort()).toEqual(["settings", "songs"]);

    const tx = db.transaction(SONGS_STORE, "readonly");
    const store = tx.objectStore(SONGS_STORE);
    expect(store.keyPath).toBe("id");
    expect(Array.from(store.indexNames)).toContain("updatedAt");
  });

  it("returns the same connection on repeated calls", async () => {
    const a = await openDb();
    const b = await openDb();
    expect(a).toBe(b);
  });
});

describe("reqToPromise", () => {
  it("rejects with the original IDBRequest error instead of swallowing it", async () => {
    const db = await openDb();

    const tx1 = db.transaction(SONGS_STORE, "readwrite");
    await reqToPromise(
      tx1.objectStore(SONGS_STORE).add({
        id: "dup",
        text: "",
        title: "",
        bpm: 120,
        hasVideo: false,
        createdAt: "",
        updatedAt: "",
      }),
    );

    const tx2 = db.transaction(SONGS_STORE, "readwrite");
    const dupReq = tx2.objectStore(SONGS_STORE).add({
      id: "dup",
      text: "x",
      title: "",
      bpm: 120,
      hasVideo: false,
      createdAt: "",
      updatedAt: "",
    });

    await expect(reqToPromise(dupReq)).rejects.toMatchObject({ name: "ConstraintError" });
  });
});
