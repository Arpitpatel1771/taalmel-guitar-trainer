import { describe, expect, it } from "vitest";
import { DriveError, listAllFiles } from "../api";
import { FakeDrive } from "./fakeDrive";

const blob = (text: string, type = "text/plain") => new Blob([text], { type });

describe("FakeDrive", () => {
  it("creates files with versions, md5 and appProperties, and bumps versions on change", async () => {
    const d = new FakeDrive();
    const f = await d.createFile({ name: "a.txt", mimeType: "text/plain", appProperties: { taalmelKind: "song", taalmelId: "1" } }, blob("hi"));
    expect(f.md5Checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(f.size).toBe("2");
    const renamed = await d.updateMetadata(f.id, { name: "b.txt" });
    expect(Number(renamed.version)).toBeGreaterThan(Number(f.version));
    const edited = await d.updateMedia(f.id, blob("hello"));
    expect(Number(edited.version)).toBeGreaterThan(Number(renamed.version));
    expect(edited.md5Checksum).not.toBe(f.md5Checksum);
    expect(await (await d.downloadMedia(f.id)).text()).toBe("hello");
    expect(renamed.appProperties).toEqual({ taalmelKind: "song", taalmelId: "1" });
  });

  it("finds folders and lists by appProperties, parent and trashed, with paging", async () => {
    const d = new FakeDrive();
    d.pageSize = 2;
    const root = await d.createFolder("Taalmel", null, { taalmelKind: "folder", taalmelId: "root" });
    expect(await d.findFolder({ taalmelKind: "folder", taalmelId: "root" })).toMatchObject({ id: root.id });
    expect(await d.findFolder({ taalmelKind: "folder", taalmelId: "nope" })).toBeNull();
    for (let i = 0; i < 5; i++) {
      await d.createFile({ name: `s${i}.txt`, mimeType: "text/plain", parents: [root.id], appProperties: { taalmelKind: "song" } }, blob("x"));
    }
    const first = await d.listFiles({ appProperties: { taalmelKind: "song" } });
    expect(first.files).toHaveLength(2);
    expect(first.nextPageToken).toBeDefined();
    const all = await listAllFiles(d, { parentId: root.id });
    expect(all).toHaveLength(5);
    await d.trash(all[0].id);
    expect(await listAllFiles(d, { parentId: root.id })).toHaveLength(4);
    expect(await listAllFiles(d, { parentId: root.id, includeTrashed: true })).toHaveLength(5);
  });

  it("moves files between parents", async () => {
    const d = new FakeDrive();
    const f = await d.createFile({ name: "a", mimeType: "text/plain", parents: ["p1"] }, blob("x"));
    const moved = await d.updateMetadata(f.id, { addParents: ["p2"], removeParents: ["p1"] });
    expect(moved.parents).toEqual(["p2"]);
  });

  it("feeds changes from a page token, one entry per file with its latest state", async () => {
    const d = new FakeDrive();
    const token = await d.getStartPageToken();
    const a = await d.createFile({ name: "a.txt", mimeType: "text/plain", appProperties: { taalmelKind: "song" } }, blob("1"));
    await d.updateMedia(a.id, blob("2"));
    const ext = d.simulateExternalCreate({ name: "x.txt", text: "ext" });
    expect(ext.appProperties).toEqual({});

    const page = await d.listChanges(token);
    expect(page.changes.map((c) => c.fileId).sort()).toEqual([a.id, ext.id].sort());
    expect(page.changes.find((c) => c.fileId === a.id)?.file?.version).toBe("2");
    expect(page.nextPageToken).toBeUndefined();

    const next = page.newStartPageToken!;
    expect((await d.listChanges(next)).changes).toEqual([]);
    d.simulateExternalEdit(a.id, "3");
    d.simulateExternalTrash(ext.id);
    const after = await d.listChanges(next);
    expect(after.changes.find((c) => c.fileId === ext.id)?.file?.trashed).toBe(true);
    expect(d.readText(a.id)).toBe("3");
  });

  it("pages the changes feed and reports removals", async () => {
    const d = new FakeDrive();
    d.pageSize = 2;
    const token = await d.getStartPageToken();
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) ids.push((await d.createFile({ name: `f${i}`, mimeType: "text/plain" }, blob("x"))).id);
    d.simulateExternalDelete(ids[0]);
    const seen: string[] = [];
    let t: string | undefined = token;
    let newStart: string | undefined;
    let removed: string[] = [];
    while (t) {
      const page = await d.listChanges(t);
      seen.push(...page.changes.map((c) => c.fileId));
      removed = removed.concat(page.changes.filter((c) => c.removed).map((c) => c.fileId));
      newStart = page.newStartPageToken;
      t = page.nextPageToken;
    }
    expect([...new Set(seen)].sort()).toEqual([...ids].sort());
    expect(new Set(removed)).toEqual(new Set([ids[0]]));
    expect(newStart).toBeDefined();
  });

  it("assembles resumable uploads from chunks and reports status", async () => {
    const d = new FakeDrive();
    const url = await d.startResumableUpload({ name: "clip.webm", mimeType: "audio/webm", appProperties: { taalmelKind: "clip" } }, 10);
    expect(await d.uploadChunk(url, blob("hello"), 0, 10)).toEqual({ done: false, received: 5 });
    expect(await d.queryUploadStatus(url, 10)).toEqual({ done: false, received: 5 });
    // A chunk at the wrong offset is ignored and reports where the server is.
    expect(await d.uploadChunk(url, blob("zzz"), 7, 10)).toEqual({ done: false, received: 5 });
    const res = await d.uploadChunk(url, blob("world"), 5, 10);
    expect(res.done).toBe(true);
    if (res.done) {
      expect(res.file.size).toBe("10");
      expect(res.file.appProperties.taalmelKind).toBe("clip");
      expect(d.readText(res.file.id)).toBe("helloworld");
    }
    await expect(d.queryUploadStatus(url, 10)).rejects.toMatchObject({ status: 404 });
  });

  it("replaces content through a resumable upload of an existing file", async () => {
    const d = new FakeDrive();
    const f = await d.createFile({ name: "a", mimeType: "text/plain" }, blob("old"));
    const url = await d.startResumableUpload({ name: "a", mimeType: "text/plain" }, 3, f.id);
    const res = await d.uploadChunk(url, blob("new"), 0, 3);
    expect(res.done && res.file.id).toBe(f.id);
    expect(d.readText(f.id)).toBe("new");
    expect(Number((await d.getMetadata(f.id)).version)).toBeGreaterThan(Number(f.version));
  });

  it("failNext fails exactly the next call", async () => {
    const d = new FakeDrive();
    d.failNext(403, "storageQuotaExceeded");
    const err = await d.createFile({ name: "a", mimeType: "text/plain" }, blob("x")).catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err).toMatchObject({ status: 403, reason: "storageQuotaExceeded" });
    expect(d.allFiles()).toHaveLength(0);
    await d.createFile({ name: "a", mimeType: "text/plain" }, blob("x"));
    expect(d.allFiles()).toHaveLength(1);
  });

  it("rejects with 404 for unknown files", async () => {
    const d = new FakeDrive();
    await expect(d.getMetadata("nope")).rejects.toMatchObject({ status: 404 });
  });
});
