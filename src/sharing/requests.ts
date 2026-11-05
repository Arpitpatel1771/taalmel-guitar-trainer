// Requests (spec 3.3): building form fields for open/join/close and
// aggregating the published rows into a board.

import { parseYouTubeId } from "../songFormat/index.js";
import { bytesToHex, sha256Hex } from "./encoding.js";
import { decodePublicKeyField, encodePublicKeyField, keyIdOfJwk, type Identity } from "./identity.js";

export const REQUEST_PARTS = ["whole", "solo", "intro", "riff", "other"] as const;
export type RequestPart = (typeof REQUEST_PARTS)[number];
export const MAX_NOTE_LENGTH = 300;

export interface RequestInput {
  title: string;
  artist: string;
  part: RequestPart;
  youtubeUrl?: string;
  note?: string;
  displayName?: string; // only when the user ticked "Show my name"
}

export class RequestValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "RequestValidationError";
  }
}

export type FormFields = Record<string, string>;

export interface OpenRequest {
  requestId: string;
  closeSecret: string;
  fields: FormFields;
}

/** Throws RequestValidationError. Returns the trimmed input. */
export function validateRequestInput(input: RequestInput): RequestInput {
  const title = input.title.trim();
  const artist = input.artist.trim();
  if (!title) throw new RequestValidationError("title", "Title is required");
  if (!artist) throw new RequestValidationError("artist", "Artist is required");
  if (!REQUEST_PARTS.includes(input.part)) throw new RequestValidationError("part", "Unknown part");
  const note = (input.note ?? "").trim();
  if (note.length > MAX_NOTE_LENGTH) throw new RequestValidationError("note", `Note is longer than ${MAX_NOTE_LENGTH} characters`);
  const youtubeUrl = (input.youtubeUrl ?? "").trim();
  if (youtubeUrl && !parseYouTubeId(youtubeUrl)) throw new RequestValidationError("youtubeUrl", "Not a YouTube link");
  return { title, artist, part: input.part, youtubeUrl, note, displayName: (input.displayName ?? "").trim() };
}

function randomSecret(): string {
  return bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
}

export async function buildOpenFields(input: RequestInput, identity: Pick<Identity, "publicKeyJwk">): Promise<OpenRequest> {
  const v = validateRequestInput(input);
  const requestId = crypto.randomUUID();
  const closeSecret = randomSecret();
  return {
    requestId,
    closeSecret,
    fields: {
      action: "open",
      requestId,
      title: v.title,
      artist: v.artist,
      part: v.part,
      youtubeUrl: v.youtubeUrl ?? "",
      note: v.note ?? "",
      displayName: v.displayName ?? "",
      publicKey: encodePublicKeyField(identity.publicKeyJwk),
      closeHash: await sha256Hex(closeSecret),
      closeSecret: "",
    },
  };
}

export function buildJoinFields(requestId: string, identity: Pick<Identity, "publicKeyJwk">, displayName = ""): FormFields {
  return {
    action: "join",
    requestId,
    title: "",
    artist: "",
    part: "",
    youtubeUrl: "",
    note: "",
    displayName: displayName.trim(),
    publicKey: encodePublicKeyField(identity.publicKeyJwk),
    closeHash: "",
    closeSecret: "",
  };
}

export function buildCloseFields(requestId: string, closeSecret: string): FormFields {
  return {
    action: "close",
    requestId,
    title: "",
    artist: "",
    part: "",
    youtubeUrl: "",
    note: "",
    displayName: "",
    publicKey: "",
    closeHash: "",
    closeSecret,
  };
}

export function buildReportFields(requestId: string, reason: string): FormFields {
  return { requestId, reason: reason.trim().slice(0, 500) };
}

export interface BoardMember {
  keyId: string;
  publicKey: JsonWebKey;
}

export interface BoardRequest {
  requestId: string;
  title: string;
  artist: string;
  part: RequestPart;
  youtubeUrl?: string;
  note?: string;
  displayName?: string;
  /** ISO-ish timestamp of the open row, if the sheet had a Timestamp column. */
  openedAt?: string;
  members: BoardMember[];
  memberCount: number;
  closed: boolean;
}

interface Internal extends BoardRequest {
  closeHash: string;
}

/**
 * Aggregates request-form rows (records keyed by field name) by requestId.
 * Malformed rows are ignored: unknown action, missing ids/title/artist, bad
 * public keys, joins for an unknown request, closes whose secret does not hash
 * to the open row's closeHash. The first `open` per requestId wins; a member
 * key counts once. Closed requests are kept with `closed: true`.
 */
export async function aggregateBoard(rows: Record<string, string>[]): Promise<BoardRequest[]> {
  const byId = new Map<string, Internal>();
  const order: Internal[] = [];

  async function memberOf(row: Record<string, string>): Promise<BoardMember | null> {
    try {
      const publicKey = decodePublicKeyField(row.publicKey ?? "");
      return { keyId: await keyIdOfJwk(publicKey), publicKey };
    } catch {
      return null;
    }
  }

  // Opens first so row order between join/open does not matter.
  for (const row of rows) {
    if ((row.action ?? "").trim() !== "open") continue;
    const requestId = (row.requestId ?? "").trim();
    const title = (row.title ?? "").trim();
    const artist = (row.artist ?? "").trim();
    const part = (row.part ?? "").trim() as RequestPart;
    const closeHash = (row.closeHash ?? "").trim().toLowerCase();
    if (!requestId || !title || !artist || !closeHash || byId.has(requestId)) continue;
    const member = await memberOf(row);
    if (!member) continue;
    const youtubeUrl = (row.youtubeUrl ?? "").trim();
    const note = (row.note ?? "").trim().slice(0, MAX_NOTE_LENGTH);
    const displayName = (row.displayName ?? "").trim();
    const req: Internal = {
      requestId,
      title,
      artist,
      part: REQUEST_PARTS.includes(part) ? part : "other",
      ...(youtubeUrl && parseYouTubeId(youtubeUrl) ? { youtubeUrl } : {}),
      ...(note ? { note } : {}),
      ...(displayName ? { displayName } : {}),
      ...(row.Timestamp ? { openedAt: row.Timestamp } : {}),
      members: [member],
      memberCount: 1,
      closed: false,
      closeHash,
    };
    byId.set(requestId, req);
    order.push(req);
  }

  for (const row of rows) {
    const action = (row.action ?? "").trim();
    const req = byId.get((row.requestId ?? "").trim());
    if (!req) continue;
    if (action === "join") {
      const member = await memberOf(row);
      if (!member || req.members.some((m) => m.keyId === member.keyId)) continue;
      req.members.push(member);
      req.memberCount = req.members.length;
    } else if (action === "close") {
      const secret = (row.closeSecret ?? "").trim();
      if (secret && (await sha256Hex(secret)) === req.closeHash) req.closed = true;
    }
  }

  return order.map(({ closeHash: _h, ...rest }) => rest);
}
