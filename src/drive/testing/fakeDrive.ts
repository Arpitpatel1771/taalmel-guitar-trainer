// In-memory DriveApi for tests (and the dev-only headless hook). Mirrors the
// Drive semantics the sync engine relies on: version bumps on every content or
// metadata change, trashed flag, appProperties, md5Checksum and a changes feed.

import {
  DriveError,
  FOLDER_MIME,
  type ChangesPage,
  type DriveApi,
  type DriveFile,
  type FileMetaPatch,
  type FilePage,
  type FileQuery,
  type NewFileMeta,
  type UploadProgress,
} from "../api";

interface Entry {
  file: DriveFile;
  bytes: Uint8Array | null;
}

interface Session {
  meta: NewFileMeta;
  existingFileId?: string;
  total: number;
  parts: Uint8Array[];
  received: number;
}

/** Stand-in content checksum (FNV-1a, not real MD5): only equality matters, and it
 * has to run in the browser too (the dev-only fake Drive hook used for UI checks). */
const md5 = (bytes: Uint8Array) => {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
};
const toBytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer());

export class FakeDrive implements DriveApi {
  /** Page size for files.list and changes.list, small by default so paging gets exercised. */
  pageSize = 100;
  private entries = new Map<string, Entry>();
  private sessions = new Map<string, Session>();
  private log: string[] = [];
  private failures: { status: number; reason: string }[] = [];
  private nextId = 1;
  private clock = Date.parse("2026-01-01T00:00:00Z");

  // test helpers

  /** The next API call rejects with this error. Calls queue up. */
  failNext(status: number, reason = "backendError"): void {
    this.failures.push({ status, reason });
  }

  simulateExternalEdit(fileId: string, text: string): DriveFile {
    const entry = this.must(fileId);
    entry.bytes = new TextEncoder().encode(text);
    return this.touch(entry);
  }

  /** A file created outside the app: no appProperties. */
  simulateExternalCreate(opts: { name: string; text: string; parents?: string[]; mimeType?: string }): DriveFile {
    const bytes = new TextEncoder().encode(opts.text);
    return this.add({ name: opts.name, mimeType: opts.mimeType ?? "text/plain", parents: opts.parents }, bytes);
  }

  simulateExternalTrash(fileId: string): DriveFile {
    const entry = this.must(fileId);
    entry.file.trashed = true;
    return this.touch(entry);
  }

  /** Permanent removal: the changes feed reports `removed: true`. */
  simulateExternalDelete(fileId: string): void {
    this.must(fileId);
    this.entries.delete(fileId);
    this.log.push(fileId);
  }

  /** Renames or moves a file outside the app. */
  simulateExternalRename(fileId: string, name: string): DriveFile {
    const entry = this.must(fileId);
    entry.file.name = name;
    return this.touch(entry);
  }

  readText(fileId: string): string {
    return new TextDecoder().decode(this.must(fileId).bytes ?? new Uint8Array());
  }

  allFiles(): DriveFile[] {
    return [...this.entries.values()].map((e) => ({ ...e.file }));
  }

  // DriveApi

  async findFolder(appProperties: Record<string, string>): Promise<DriveFile | null> {
    this.check();
    const found = [...this.entries.values()].find(
      (e) => e.file.mimeType === FOLDER_MIME && !e.file.trashed && matchesProps(e.file, appProperties)
    );
    return found ? { ...found.file } : null;
  }

  async createFolder(name: string, parentId: string | null, appProperties: Record<string, string> = {}): Promise<DriveFile> {
    this.check();
    return this.add({ name, mimeType: FOLDER_MIME, parents: parentId ? [parentId] : undefined, appProperties }, null);
  }

  async listFiles(query: FileQuery, pageToken?: string): Promise<FilePage> {
    this.check();
    const all = [...this.entries.values()]
      .map((e) => e.file)
      .filter(
        (f) =>
          matchesProps(f, query.appProperties ?? {}) &&
          (!query.parentId || f.parents.includes(query.parentId)) &&
          (query.includeTrashed || !f.trashed)
      );
    const start = pageToken ? Number(pageToken) : 0;
    const slice = all.slice(start, start + this.pageSize);
    const next = start + this.pageSize;
    return { files: slice.map((f) => ({ ...f })), nextPageToken: next < all.length ? String(next) : undefined };
  }

  async getMetadata(fileId: string): Promise<DriveFile> {
    this.check();
    return { ...this.must(fileId).file };
  }

  async downloadMedia(fileId: string, onProgress?: (fraction: number) => void): Promise<Blob> {
    this.check();
    const entry = this.must(fileId);
    onProgress?.(0.5);
    onProgress?.(1);
    return new Blob([(entry.bytes ?? new Uint8Array()) as BlobPart], { type: entry.file.mimeType });
  }

  async createFile(meta: NewFileMeta, media: Blob): Promise<DriveFile> {
    this.check();
    return this.add(meta, await toBytes(media));
  }

  async updateMetadata(fileId: string, patch: FileMetaPatch): Promise<DriveFile> {
    this.check();
    const entry = this.must(fileId);
    const f = entry.file;
    if (patch.name !== undefined) f.name = patch.name;
    if (patch.appProperties) f.appProperties = { ...f.appProperties, ...patch.appProperties };
    if (patch.trashed !== undefined) f.trashed = patch.trashed;
    if (patch.removeParents) f.parents = f.parents.filter((p) => !patch.removeParents!.includes(p));
    if (patch.addParents) f.parents = [...f.parents, ...patch.addParents.filter((p) => !f.parents.includes(p))];
    return this.touch(entry);
  }

  async updateMedia(fileId: string, media: Blob): Promise<DriveFile> {
    this.check();
    const entry = this.must(fileId);
    entry.bytes = await toBytes(media);
    return this.touch(entry);
  }

  async trash(fileId: string): Promise<DriveFile> {
    return this.updateMetadata(fileId, { trashed: true });
  }

  async startResumableUpload(meta: NewFileMeta, totalSize: number, existingFileId?: string): Promise<string> {
    this.check();
    if (existingFileId) this.must(existingFileId);
    const url = `fake://upload/${this.nextId++}`;
    this.sessions.set(url, { meta, existingFileId, total: totalSize, parts: [], received: 0 });
    return url;
  }

  async uploadChunk(sessionUrl: string, chunk: Blob, offset: number, totalSize: number): Promise<UploadProgress> {
    this.check();
    const s = this.session(sessionUrl);
    if (totalSize !== s.total) throw new DriveError(400, "badRequest");
    // Like Drive, a chunk that doesn't continue where the server is leaves the session untouched.
    if (offset !== s.received) return { done: false, received: s.received };
    const bytes = await toBytes(chunk);
    s.parts.push(bytes);
    s.received += bytes.length;
    return this.progress(sessionUrl, s);
  }

  async queryUploadStatus(sessionUrl: string, _totalSize?: number): Promise<UploadProgress> {
    this.check();
    return this.progress(sessionUrl, this.session(sessionUrl));
  }

  async getStartPageToken(): Promise<string> {
    this.check();
    return String(this.log.length);
  }

  async listChanges(pageToken: string): Promise<ChangesPage> {
    this.check();
    const start = Number(pageToken);
    if (!Number.isInteger(start) || start < 0 || start > this.log.length) throw new DriveError(400, "badRequest");
    // Walk the log until a page of distinct files is full; a file touched again later reappears on a later page.
    const ids = new Set<string>();
    let pos = start;
    while (pos < this.log.length && (ids.size < this.pageSize || ids.has(this.log[pos]))) ids.add(this.log[pos++]);
    const changes = [...ids].map((fileId) => {
      const entry = this.entries.get(fileId);
      return entry ? { fileId, removed: false, file: { ...entry.file } } : { fileId, removed: true };
    });
    if (pos < this.log.length) return { changes, nextPageToken: String(pos) };
    return { changes, newStartPageToken: String(this.log.length) };
  }

  // internals

  private check(): void {
    const f = this.failures.shift();
    if (f) throw new DriveError(f.status, f.reason);
  }

  private must(fileId: string): Entry {
    const e = this.entries.get(fileId);
    if (!e) throw new DriveError(404, "notFound", `File not found: ${fileId}`);
    return e;
  }

  private session(url: string): Session {
    const s = this.sessions.get(url);
    if (!s) throw new DriveError(404, "notFound", "Upload session not found");
    return s;
  }

  private tick(): string {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }

  private touch(entry: Entry): DriveFile {
    entry.file.version = String(Number(entry.file.version) + 1);
    entry.file.modifiedTime = this.tick();
    if (entry.bytes) {
      entry.file.md5Checksum = md5(entry.bytes);
      entry.file.size = String(entry.bytes.length);
    }
    this.log.push(entry.file.id);
    return { ...entry.file };
  }

  private add(meta: NewFileMeta, bytes: Uint8Array | null): DriveFile {
    const id = `fake-${this.nextId++}`;
    const file: DriveFile = {
      id,
      name: meta.name,
      mimeType: meta.mimeType,
      parents: meta.parents ? [...meta.parents] : [],
      appProperties: { ...(meta.appProperties ?? {}) },
      version: "0",
      modifiedTime: this.tick(),
      trashed: false,
    };
    const entry: Entry = { file, bytes };
    this.entries.set(id, entry);
    return this.touch(entry);
  }

  private async progress(url: string, s: Session): Promise<UploadProgress> {
    if (s.received < s.total) return { done: false, received: s.received };
    const all = new Uint8Array(s.total);
    let pos = 0;
    for (const p of s.parts) {
      all.set(p, pos);
      pos += p.length;
    }
    this.sessions.delete(url);
    if (s.existingFileId) {
      const entry = this.must(s.existingFileId);
      entry.bytes = all;
      return { done: true, file: this.touch(entry) };
    }
    return { done: true, file: this.add(s.meta, all) };
  }
}

function matchesProps(f: DriveFile, props: Record<string, string>): boolean {
  return Object.entries(props).every(([k, v]) => f.appProperties[k] === v);
}
