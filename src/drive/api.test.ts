import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DriveError, FILE_FIELDS, RestDriveApi, buildFileQuery } from "./api";

const FILE = { id: "f1", name: "a", mimeType: "text/plain", parents: [], appProperties: {}, version: "1", modifiedTime: "t", trashed: false };

let fetchMock: ReturnType<typeof vi.fn>;
const api = () => new RestDriveApi(async () => "tok");
const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });
const lastCall = () => {
  const [url, init] = fetchMock.mock.calls.at(-1)!;
  return { url: new URL(url as string), init: init as RequestInit, headers: new Headers((init as RequestInit).headers) };
};

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("buildFileQuery", () => {
  it("combines appProperties, parent and trashed filters and escapes quotes", () => {
    expect(buildFileQuery({ appProperties: { taalmelKind: "song" }, parentId: "p" })).toBe(
      "appProperties has { key='taalmelKind' and value='song' } and 'p' in parents and trashed = false"
    );
    expect(buildFileQuery({ appProperties: { k: "it's" }, includeTrashed: true })).toContain("value='it\\'s'");
  });
});

describe("RestDriveApi requests", () => {
  it("lists files with q, fields, paging and a bearer token", async () => {
    fetchMock.mockResolvedValue(json({ files: [FILE], nextPageToken: "n2" }));
    const page = await api().listFiles({ appProperties: { taalmelKind: "song" } }, "n1");
    expect(page.nextPageToken).toBe("n2");
    const { url, headers } = lastCall();
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/drive/v3/files");
    expect(url.searchParams.get("q")).toBe("appProperties has { key='taalmelKind' and value='song' } and trashed = false");
    expect(url.searchParams.get("pageToken")).toBe("n1");
    expect(url.searchParams.get("fields")).toContain("nextPageToken");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });

  it("finds a folder by appProperties and mime type", async () => {
    fetchMock.mockResolvedValue(json({ files: [] }));
    expect(await api().findFolder({ taalmelKind: "folder", taalmelId: "root" })).toBeNull();
    const q = lastCall().url.searchParams.get("q")!;
    expect(q).toContain("key='taalmelId' and value='root'");
    expect(q).toContain("mimeType = 'application/vnd.google-apps.folder'");
  });

  it("creates a folder with parents and appProperties", async () => {
    fetchMock.mockResolvedValue(json(FILE));
    await api().createFolder("Songs", "root1", { taalmelKind: "folder" });
    const { init, url } = lastCall();
    expect(init.method).toBe("POST");
    expect(url.searchParams.get("fields")).toBe(FILE_FIELDS);
    expect(JSON.parse(init.body as string)).toEqual({
      name: "Songs",
      mimeType: "application/vnd.google-apps.folder",
      appProperties: { taalmelKind: "folder" },
      parents: ["root1"],
    });
  });

  it("downloads media with alt=media", async () => {
    fetchMock.mockResolvedValue(new Response("abc"));
    expect(await (await api().downloadMedia("f 1")).text()).toBe("abc");
    const { url } = lastCall();
    expect(url.pathname).toBe("/drive/v3/files/f%201");
    expect(url.searchParams.get("alt")).toBe("media");
  });

  it("reports streamed download progress using Content-Length, else the size hint", async () => {
    const stream = () =>
      new ReadableStream<Uint8Array>({
        start(c) {
          c.enqueue(new Uint8Array([1, 2, 3, 4]));
          c.enqueue(new Uint8Array([5, 6, 7, 8]));
          c.close();
        },
      });
    fetchMock.mockResolvedValueOnce(new Response(stream(), { headers: { "Content-Length": "8" } }));
    const a: number[] = [];
    const blob = await api().downloadMedia("f1", (f) => a.push(f));
    expect(blob.size).toBe(8);
    expect(a).toEqual([0.5, 1, 1]);
    fetchMock.mockResolvedValueOnce(new Response(stream()));
    const b: number[] = [];
    await api().downloadMedia("f1", (f) => b.push(f), 16);
    expect(b).toEqual([0.25, 0.5, 1]);
  });

  it("creates a multipart file with metadata and media between boundaries", async () => {
    fetchMock.mockResolvedValue(json(FILE));
    await api().createFile({ name: "a.txt", mimeType: "text/plain", parents: ["p"], appProperties: { k: "v" } }, new Blob(["BODY"]));
    const { url, init, headers } = lastCall();
    expect(url.origin + url.pathname).toBe("https://www.googleapis.com/upload/drive/v3/files");
    expect(url.searchParams.get("uploadType")).toBe("multipart");
    const boundary = /^multipart\/related; boundary=(.+)$/.exec(headers.get("Content-Type")!)![1];
    const body = await (init.body as Blob).text();
    expect(body.startsWith(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{`)).toBe(true);
    expect(body).toContain(`\r\n--${boundary}\r\nContent-Type: text/plain\r\n\r\nBODY\r\n--${boundary}--`);
    expect(body).toContain('"appProperties":{"k":"v"}');
  });

  it("patches metadata, moving files with addParents/removeParents in the query", async () => {
    fetchMock.mockResolvedValue(json(FILE));
    await api().updateMetadata("f1", { name: "n", addParents: ["a"], removeParents: ["b", "c"] });
    const { url, init } = lastCall();
    expect(init.method).toBe("PATCH");
    expect(url.searchParams.get("addParents")).toBe("a");
    expect(url.searchParams.get("removeParents")).toBe("b,c");
    expect(JSON.parse(init.body as string)).toEqual({ name: "n" });
  });

  it("updates media with uploadType=media, and trashes via a metadata patch", async () => {
    fetchMock.mockImplementation(async () => json(FILE));
    await api().updateMedia("f1", new Blob(["x"], { type: "text/plain" }));
    expect(lastCall().url.pathname).toBe("/upload/drive/v3/files/f1");
    expect(lastCall().url.searchParams.get("uploadType")).toBe("media");
    await api().trash("f1");
    expect(JSON.parse(lastCall().init.body as string)).toEqual({ trashed: true });
  });

  it("starts a resumable session and returns the Location header", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200, headers: { Location: "https://upload/session1" } }));
    const url = await api().startResumableUpload({ name: "c.webm", mimeType: "audio/webm" }, 1234);
    expect(url).toBe("https://upload/session1");
    const call = lastCall();
    expect(call.url.searchParams.get("uploadType")).toBe("resumable");
    expect(call.init.method).toBe("POST");
    expect(call.headers.get("X-Upload-Content-Type")).toBe("audio/webm");
    expect(call.headers.get("X-Upload-Content-Length")).toBe("1234");

    await api().startResumableUpload({ name: "c.webm", mimeType: "audio/webm" }, 5, "f9");
    expect(lastCall().init.method).toBe("PATCH");
    expect(lastCall().url.pathname).toBe("/upload/drive/v3/files/f9");
  });

  it("uploads chunks with Content-Range and parses 308 / final responses", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 308, headers: { Range: "bytes=0-4" } }));
    expect(await api().uploadChunk("https://upload/s", new Blob(["hello"]), 0, 10)).toEqual({ done: false, received: 5 });
    expect(lastCall().init.method).toBe("PUT");
    expect(lastCall().headers.get("Content-Range")).toBe("bytes 0-4/10");

    fetchMock.mockResolvedValueOnce(json(FILE));
    const res = await api().uploadChunk("https://upload/s", new Blob(["world"]), 5, 10);
    expect(res).toEqual({ done: true, file: FILE });
    expect(lastCall().headers.get("Content-Range")).toBe("bytes 5-9/10");
  });

  it("queries upload status with bytes */total, treating a missing Range as 0 received", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 308 }));
    expect(await api().queryUploadStatus("https://upload/s", 10)).toEqual({ done: false, received: 0 });
    expect(lastCall().headers.get("Content-Range")).toBe("bytes */10");
  });

  it("gets the start token and lists changes", async () => {
    fetchMock.mockResolvedValueOnce(json({ startPageToken: "42" }));
    expect(await api().getStartPageToken()).toBe("42");
    expect(lastCall().url.pathname).toBe("/drive/v3/changes/startPageToken");

    fetchMock.mockResolvedValueOnce(json({ changes: [{ fileId: "f1", removed: true }], newStartPageToken: "43" }));
    const page = await api().listChanges("42");
    expect(page.newStartPageToken).toBe("43");
    const { url } = lastCall();
    expect(url.pathname).toBe("/drive/v3/changes");
    expect(url.searchParams.get("pageToken")).toBe("42");
    expect(url.searchParams.get("includeRemoved")).toBe("true");
    expect(url.searchParams.get("fields")).toContain("changes(fileId,removed,file(");
  });
});

describe("RestDriveApi errors", () => {
  it("maps Google's error JSON to DriveError with the reason", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: 403, message: "Quota", errors: [{ reason: "storageQuotaExceeded" }] } }, { status: 403 }));
    const err = await api().getMetadata("f1").catch((e) => e);
    expect(err).toBeInstanceOf(DriveError);
    expect(err).toMatchObject({ status: 403, reason: "storageQuotaExceeded", message: "Quota" });
  });

  it("falls back to error.status, then 'unknown' for non-JSON bodies", async () => {
    fetchMock.mockResolvedValueOnce(json({ error: { status: "UNAUTHENTICATED" } }, { status: 401 }));
    expect(await api().getMetadata("f1").catch((e) => e)).toMatchObject({ status: 401, reason: "UNAUTHENTICATED" });
    fetchMock.mockResolvedValueOnce(new Response("<html>", { status: 503 }));
    expect(await api().getMetadata("f1").catch((e) => e)).toMatchObject({ status: 503, reason: "unknown" });
  });

  it("maps fetch failures to status 0 networkError", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await api().getMetadata("f1").catch((e) => e)).toMatchObject({ status: 0, reason: "networkError" });
  });
});
