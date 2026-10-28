import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  SYNC_DB_NAME,
  _resetSyncDbForTests,
  dequeue,
  deleteItem,
  deleteMeta,
  enqueue,
  getItem,
  getMeta,
  listItems,
  listQueue,
  putItem,
  setMeta,
  updateQueueItem,
} from "./syncDb";

afterEach(async () => {
  await _resetSyncDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(SYNC_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

const item = (id: string, kind: "song" | "clip" = "song") => ({
  kind,
  id,
  driveFileId: `d-${id}`,
  lastSyncedHash: "h",
  lastRemoteVersion: "3",
});

describe("syncDb", () => {
  it("puts, gets, lists and deletes items keyed kind:id", async () => {
    const saved = await putItem(item("a"));
    expect(saved.key).toBe("song:a");
    await putItem(item("a", "clip"));
    expect(await getItem("song", "a")).toMatchObject({ driveFileId: "d-a" });
    expect(await listItems()).toHaveLength(2);
    expect(await listItems("clip")).toHaveLength(1);
    await putItem({ ...item("a"), lastRemoteVersion: "4", deletedLocally: true });
    expect((await getItem("song", "a"))?.lastRemoteVersion).toBe("4");
    await deleteItem("song", "a");
    expect(await getItem("song", "a")).toBeUndefined();
  });

  it("de-duplicates the queue per kind:id, keeping the first enqueuedAt and the latest op", async () => {
    await enqueue("upsert", "song", "a", 10);
    await enqueue("upsert", "song", "b", 20);
    await updateQueueItem("song:a", { attempts: 3 });
    const again = await enqueue("delete", "song", "a", 30);
    expect(again).toMatchObject({ op: "delete", enqueuedAt: 10, attempts: 0 });
    const q = await listQueue();
    expect(q.map((x) => `${x.key}:${x.op}`)).toEqual(["song:a:delete", "song:b:upsert"]);
  });

  it("keeps clip meta and media ops separate, and preserves a resumable URL for the same media op", async () => {
    await enqueue("upsert", "clip", "c", 1);
    await enqueue("uploadMedia", "clip", "c", 2);
    expect(await listQueue()).toHaveLength(2);
    await updateQueueItem("clip:c:media", { resumableUrl: "https://u/1", attempts: 1 });
    await enqueue("uploadMedia", "clip", "c", 5);
    const media = (await listQueue()).find((x) => x.op === "uploadMedia");
    expect(media).toMatchObject({ resumableUrl: "https://u/1", attempts: 0, enqueuedAt: 2 });
  });

  it("updates attempts and dequeues", async () => {
    await enqueue("upsert", "song", "a", 1);
    await updateQueueItem("song:a", { attempts: 2 });
    expect((await listQueue())[0].attempts).toBe(2);
    await updateQueueItem("song:missing", { attempts: 1 });
    await dequeue("song:a");
    expect(await listQueue()).toEqual([]);
  });

  it("gets, sets and deletes meta values", async () => {
    expect(await getMeta("changesPageToken")).toBeUndefined();
    await setMeta("changesPageToken", "99");
    await setMeta("folders", { root: "r", songs: "s" });
    expect(await getMeta<string>("changesPageToken")).toBe("99");
    expect(await getMeta("folders")).toEqual({ root: "r", songs: "s" });
    await deleteMeta("changesPageToken");
    expect(await getMeta("changesPageToken")).toBeUndefined();
  });
});
