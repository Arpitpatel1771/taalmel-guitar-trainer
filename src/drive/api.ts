// A thin wrapper over Drive REST v3 behind the DriveApi interface, so the sync
// engine can be tested against an in-memory FakeDrive (see testing/fakeDrive.ts).

const DRIVE_URL = "https://www.googleapis.com/drive/v3";
const UPLOAD_URL = "https://www.googleapis.com/upload/drive/v3";
export const FOLDER_MIME = "application/vnd.google-apps.folder";
export const FILE_FIELDS = "id,name,mimeType,parents,appProperties,version,md5Checksum,modifiedTime,trashed,size";

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  parents: string[];
  appProperties: Record<string, string>;
  /** Drive's monotonically increasing version (a decimal string). */
  version: string;
  md5Checksum?: string;
  modifiedTime: string;
  trashed: boolean;
  size?: string;
}

export interface NewFileMeta {
  name: string;
  mimeType: string;
  parents?: string[];
  appProperties?: Record<string, string>;
}

export interface FileMetaPatch {
  name?: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
  /** Moves the file: parents to add / remove. */
  addParents?: string[];
  removeParents?: string[];
}

export interface FileQuery {
  appProperties?: Record<string, string>;
  /** Only files directly inside this folder. */
  parentId?: string;
  includeTrashed?: boolean;
}

export interface FilePage {
  files: DriveFile[];
  nextPageToken?: string;
}

export type UploadProgress = { done: false; received: number } | { done: true; file: DriveFile };

export interface DriveChange {
  fileId: string;
  removed: boolean;
  file?: DriveFile;
}

export interface ChangesPage {
  changes: DriveChange[];
  /** Set on the last page: store it as the next start token. */
  newStartPageToken?: string;
  /** Set when more pages remain. */
  nextPageToken?: string;
}

export interface DriveApi {
  findFolder(appProperties: Record<string, string>): Promise<DriveFile | null>;
  createFolder(name: string, parentId: string | null, appProperties?: Record<string, string>): Promise<DriveFile>;
  listFiles(query: FileQuery, pageToken?: string): Promise<FilePage>;
  getMetadata(fileId: string): Promise<DriveFile>;
  /** `onProgress` gets a 0..1 fraction; `sizeHint` (bytes) is used when Content-Length is missing. */
  downloadMedia(fileId: string, onProgress?: (fraction: number) => void, sizeHint?: number): Promise<Blob>;
  /** Multipart create for small files. */
  createFile(meta: NewFileMeta, media: Blob): Promise<DriveFile>;
  updateMetadata(fileId: string, patch: FileMetaPatch): Promise<DriveFile>;
  updateMedia(fileId: string, media: Blob): Promise<DriveFile>;
  trash(fileId: string): Promise<DriveFile>;
  /** Starts a resumable session and returns its URL. With `existingFileId` it replaces that file's content. */
  startResumableUpload(meta: NewFileMeta, totalSize: number, existingFileId?: string): Promise<string>;
  /** Uploads bytes [offset, offset + chunk.size) of `totalSize`. */
  uploadChunk(sessionUrl: string, chunk: Blob, offset: number, totalSize: number): Promise<UploadProgress>;
  /** `received` is the number of bytes Drive already has. An expired session rejects with a 404 DriveError. */
  queryUploadStatus(sessionUrl: string, totalSize: number): Promise<UploadProgress>;
  getStartPageToken(): Promise<string>;
  listChanges(pageToken: string): Promise<ChangesPage>;
}

/** status 0 means a network failure (reason "networkError"). */
export class DriveError extends Error {
  constructor(
    public readonly status: number,
    public readonly reason: string,
    message?: string
  ) {
    super(message ?? `Drive request failed (${status} ${reason})`);
    this.name = "DriveError";
  }
}

/** Collects every page of a listing. */
export async function listAllFiles(api: DriveApi, query: FileQuery): Promise<DriveFile[]> {
  const out: DriveFile[] = [];
  let token: string | undefined;
  do {
    const page = await api.listFiles(query, token);
    out.push(...page.files);
    token = page.nextPageToken;
  } while (token);
  return out;
}

const escapeQ = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

export function buildFileQuery(q: FileQuery): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(q.appProperties ?? {})) {
    parts.push(`appProperties has { key='${escapeQ(k)}' and value='${escapeQ(v)}' }`);
  }
  if (q.parentId) parts.push(`'${escapeQ(q.parentId)}' in parents`);
  if (!q.includeTrashed) parts.push("trashed = false");
  return parts.join(" and ");
}

export class RestDriveApi implements DriveApi {
  constructor(private readonly getToken: () => Promise<string>) {}

  private async send(url: string, init: RequestInit = {}): Promise<Response> {
    const token = await this.getToken();
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${token}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      throw new DriveError(0, "networkError", e instanceof Error ? e.message : "Network request failed");
    }
    if (!res.ok && res.status !== 308) throw await toDriveError(res);
    return res;
  }

  private async json<T>(url: string, init?: RequestInit): Promise<T> {
    return (await this.send(url, init)).json() as Promise<T>;
  }

  private jsonInit(method: string, body: unknown): RequestInit {
    return { method, headers: { "Content-Type": "application/json; charset=UTF-8" }, body: JSON.stringify(body) };
  }

  async findFolder(appProperties: Record<string, string>): Promise<DriveFile | null> {
    const q = `${buildFileQuery({ appProperties })} and mimeType = '${FOLDER_MIME}'`;
    const page = await this.json<{ files: DriveFile[] }>(
      `${DRIVE_URL}/files?${new URLSearchParams({ q, fields: `files(${FILE_FIELDS})`, pageSize: "1" })}`
    );
    return page.files[0] ?? null;
  }

  createFolder(name: string, parentId: string | null, appProperties: Record<string, string> = {}): Promise<DriveFile> {
    const body = { name, mimeType: FOLDER_MIME, appProperties, ...(parentId ? { parents: [parentId] } : {}) };
    return this.json(`${DRIVE_URL}/files?${new URLSearchParams({ fields: FILE_FIELDS })}`, this.jsonInit("POST", body));
  }

  listFiles(query: FileQuery, pageToken?: string): Promise<FilePage> {
    const params = new URLSearchParams({
      q: buildFileQuery(query),
      fields: `nextPageToken,files(${FILE_FIELDS})`,
      pageSize: "100",
    });
    if (pageToken) params.set("pageToken", pageToken);
    return this.json(`${DRIVE_URL}/files?${params}`);
  }

  getMetadata(fileId: string): Promise<DriveFile> {
    return this.json(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ fields: FILE_FIELDS })}`);
  }

  async downloadMedia(fileId: string, onProgress?: (fraction: number) => void, sizeHint?: number): Promise<Blob> {
    const res = await this.send(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}?alt=media`);
    if (!onProgress || !res.body) return res.blob();
    const header = Number(res.headers.get("Content-Length"));
    const total = header > 0 ? header : (sizeHint ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (total > 0) onProgress(Math.min(received / total, 1));
    }
    onProgress(1);
    return new Blob(chunks as BlobPart[], { type: res.headers.get("Content-Type") ?? "" });
  }

  createFile(meta: NewFileMeta, media: Blob): Promise<DriveFile> {
    const { body, contentType } = multipartBody(meta, media);
    return this.json(`${UPLOAD_URL}/files?${new URLSearchParams({ uploadType: "multipart", fields: FILE_FIELDS })}`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body,
    });
  }

  updateMetadata(fileId: string, patch: FileMetaPatch): Promise<DriveFile> {
    const { addParents, removeParents, ...body } = patch;
    const params = new URLSearchParams({ fields: FILE_FIELDS });
    if (addParents?.length) params.set("addParents", addParents.join(","));
    if (removeParents?.length) params.set("removeParents", removeParents.join(","));
    return this.json(`${DRIVE_URL}/files/${encodeURIComponent(fileId)}?${params}`, this.jsonInit("PATCH", body));
  }

  updateMedia(fileId: string, media: Blob): Promise<DriveFile> {
    return this.json(
      `${UPLOAD_URL}/files/${encodeURIComponent(fileId)}?${new URLSearchParams({ uploadType: "media", fields: FILE_FIELDS })}`,
      { method: "PATCH", headers: { "Content-Type": media.type || "application/octet-stream" }, body: media }
    );
  }

  trash(fileId: string): Promise<DriveFile> {
    return this.updateMetadata(fileId, { trashed: true });
  }

  async startResumableUpload(meta: NewFileMeta, totalSize: number, existingFileId?: string): Promise<string> {
    const params = new URLSearchParams({ uploadType: "resumable", fields: FILE_FIELDS });
    const url = existingFileId
      ? `${UPLOAD_URL}/files/${encodeURIComponent(existingFileId)}?${params}`
      : `${UPLOAD_URL}/files?${params}`;
    const res = await this.send(url, {
      method: existingFileId ? "PATCH" : "POST",
      headers: {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": meta.mimeType,
        "X-Upload-Content-Length": String(totalSize),
      },
      body: JSON.stringify(meta),
    });
    const location = res.headers.get("Location");
    if (!location) throw new DriveError(res.status, "noUploadUrl", "Drive did not return an upload URL.");
    return location;
  }

  async uploadChunk(sessionUrl: string, chunk: Blob, offset: number, totalSize: number): Promise<UploadProgress> {
    const end = offset + chunk.size - 1;
    const res = await this.send(sessionUrl, {
      method: "PUT",
      headers: { "Content-Range": `bytes ${offset}-${end}/${totalSize}` },
      body: chunk,
    });
    return uploadProgress(res);
  }

  async queryUploadStatus(sessionUrl: string, totalSize: number): Promise<UploadProgress> {
    const res = await this.send(sessionUrl, { method: "PUT", headers: { "Content-Range": `bytes */${totalSize}` } });
    return uploadProgress(res);
  }

  async getStartPageToken(): Promise<string> {
    const data = await this.json<{ startPageToken: string }>(`${DRIVE_URL}/changes/startPageToken`);
    return data.startPageToken;
  }

  listChanges(pageToken: string): Promise<ChangesPage> {
    const params = new URLSearchParams({
      pageToken,
      pageSize: "100",
      includeRemoved: "true",
      fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FILE_FIELDS}))`,
    });
    return this.json(`${DRIVE_URL}/changes?${params}`);
  }
}

async function uploadProgress(res: Response): Promise<UploadProgress> {
  if (res.status === 308) {
    // Range: bytes=0-N means N+1 bytes are stored; no header means none.
    const m = /bytes=0-(\d+)/.exec(res.headers.get("Range") ?? "");
    return { done: false, received: m ? Number(m[1]) + 1 : 0 };
  }
  return { done: true, file: (await res.json()) as DriveFile };
}

export function multipartBody(meta: NewFileMeta, media: Blob): { body: Blob; contentType: string } {
  const boundary = `taalmel-${crypto.randomUUID()}`;
  const head = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n`;
  const mid = `--${boundary}\r\nContent-Type: ${meta.mimeType || "application/octet-stream"}\r\n\r\n`;
  const tail = `\r\n--${boundary}--`;
  return { body: new Blob([head, mid, media, tail]), contentType: `multipart/related; boundary=${boundary}` };
}

async function toDriveError(res: Response): Promise<DriveError> {
  let reason = "unknown";
  let message: string | undefined;
  try {
    const data = (await res.json()) as { error?: { message?: string; status?: string; errors?: { reason?: string }[] } };
    reason = data.error?.errors?.[0]?.reason ?? data.error?.status ?? reason;
    message = data.error?.message;
  } catch {
    // Non-JSON error body: keep the defaults.
  }
  return new DriveError(res.status, reason, message);
}
