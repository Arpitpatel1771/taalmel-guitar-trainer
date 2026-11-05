// Encrypted replies (spec 3.4): ephemeral ECDH P-256 -> HKDF-SHA-256
// (info "taalmel-reply-v1") -> AES-GCM-256 over gzip(JSON payload).

import type { Song } from "../model/index.js";
import { parse } from "../songFormat/index.js";
import { base64ToBytes, bytesToBase64, compress, decompress, fromUtf8, utf8 } from "./encoding.js";
import { importPublicKeyJwk, keyIdOfJwk } from "./identity.js";
import type { BoardMember } from "./requests.js";

export const REPLY_INFO = "taalmel-reply-v1";
export const MAX_CIPHERTEXT_CHARS = 40_000;
const MAX_PLAINTEXT_BYTES = 1_000_000;

export interface ReplyPayload {
  songText: string;
  displayName?: string;
  note?: string;
  sentAt: string;
}

/** Replies-form fields except requestId. */
export interface EncryptedReply {
  recipientKeyId: string;
  senderPublicKey: string; // base64 of the raw ephemeral public key
  iv: string; // base64
  ciphertext: string; // base64
}

export interface ReplyRow extends EncryptedReply {
  requestId: string;
}

export class ReplyTooLargeError extends Error {
  constructor(public readonly size: number) {
    super("This song is too long to send this way; use Copy as text");
    this.name = "ReplyTooLargeError";
  }
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

async function deriveAesKey(privateKey: CryptoKey, publicKey: CryptoKey, usage: KeyUsage): Promise<CryptoKey> {
  const bits = await crypto.subtle.deriveBits({ name: "ECDH", public: publicKey }, privateKey, 256);
  const hkdfKey = await crypto.subtle.importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: utf8(REPLY_INFO) },
    hkdfKey,
    { name: "AES-GCM", length: 256 },
    false,
    [usage],
  );
}

export async function encryptReply(recipientPublicKeyJwk: JsonWebKey, payload: ReplyPayload): Promise<EncryptedReply> {
  const recipient = await importPublicKeyJwk(recipientPublicKeyJwk);
  const eph = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const aes = await deriveAesKey(eph.privateKey, recipient, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const gz = await compress(utf8(JSON.stringify(payload)), "gzip");
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, gz as Uint8Array<ArrayBuffer>));
  const ciphertext = bytesToBase64(ct);
  if (ciphertext.length > MAX_CIPHERTEXT_CHARS) throw new ReplyTooLargeError(ciphertext.length);
  return {
    recipientKeyId: await keyIdOfJwk(recipientPublicKeyJwk),
    senderPublicKey: bytesToBase64(new Uint8Array(await crypto.subtle.exportKey("raw", eph.publicKey))),
    iv: bytesToBase64(iv),
    ciphertext,
  };
}

/** One row per member key, for one share. Throws ReplyTooLargeError if the song is too long. */
export async function buildReplyRows(requestId: string, members: BoardMember[], payload: ReplyPayload): Promise<ReplyRow[]> {
  return Promise.all(members.map(async (m) => ({ requestId, ...(await encryptReply(m.publicKey, payload)) })));
}

/** Throws if the row is not decryptable with `privateKey` (wrong key, tampering, malformed). */
export async function decryptReply(
  row: Pick<EncryptedReply, "senderPublicKey" | "iv" | "ciphertext">,
  privateKey: CryptoKey,
): Promise<ReplyPayload> {
  const sender = await crypto.subtle.importKey("raw", base64ToBytes(row.senderPublicKey), ECDH, true, []);
  const aes = await deriveAesKey(privateKey, sender, "decrypt");
  const gz = new Uint8Array(
    await crypto.subtle.decrypt({ name: "AES-GCM", iv: base64ToBytes(row.iv) }, aes, base64ToBytes(row.ciphertext)),
  );
  const json = JSON.parse(fromUtf8(await decompress(gz, "gzip", MAX_PLAINTEXT_BYTES))) as Partial<ReplyPayload>;
  if (typeof json.songText !== "string" || typeof json.sentAt !== "string") throw new Error("Malformed reply payload");
  return {
    songText: json.songText,
    sentAt: json.sentAt,
    ...(typeof json.displayName === "string" && json.displayName ? { displayName: json.displayName } : {}),
    ...(typeof json.note === "string" && json.note ? { note: json.note } : {}),
  };
}

/** Stable local id for a reply row (used for "Hide"). */
export function replyId(row: Pick<EncryptedReply, "recipientKeyId" | "iv">): string {
  return `${row.recipientKeyId}:${row.iv}`;
}

export interface MyReply {
  replyId: string;
  requestId: string;
  recipientKeyId: string;
  payload: ReplyPayload;
  song: Song;
}

export interface MyKey {
  keyId: string;
  privateKey: CryptoKey;
}

/**
 * Keeps rows addressed to one of `myKeys`, decrypts them, and drops (silently)
 * any that fail to decrypt or whose songText is not a valid song.
 */
export async function collectMyReplies(rows: Record<string, string>[], myKeys: MyKey[]): Promise<MyReply[]> {
  const out: MyReply[] = [];
  for (const row of rows) {
    const key = myKeys.find((k) => k.keyId === (row.recipientKeyId ?? "").trim());
    if (!key) continue;
    const enc = {
      recipientKeyId: key.keyId,
      senderPublicKey: row.senderPublicKey ?? "",
      iv: row.iv ?? "",
      ciphertext: row.ciphertext ?? "",
    };
    try {
      const payload = await decryptReply(enc, key.privateKey);
      const parsed = parse(payload.songText);
      if (!parsed.ok) continue;
      out.push({ replyId: replyId(enc), requestId: (row.requestId ?? "").trim(), recipientKeyId: key.keyId, payload, song: parsed.song });
    } catch {
      // not decryptable or malformed: drop
    }
  }
  return out;
}
