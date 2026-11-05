// Direct share links (spec 4): `${origin}/s#<base64url(deflate-raw(songText))>`.

import { parse } from "../songFormat/index.js";
import type { Song } from "../model/index.js";
import { base64UrlToBytes, bytesToBase64Url, compress, decompress, fromUtf8, utf8 } from "./encoding.js";

export const MAX_SHARE_LINK_LENGTH = 8000;
const MAX_SONG_BYTES = 500_000;

export async function encodeShareLink(songText: string, origin: string): Promise<string> {
  const packed = await compress(utf8(songText), "deflate-raw");
  return `${origin.replace(/\/+$/, "")}/s#${bytesToBase64Url(packed)}`;
}

/** Links longer than 8000 characters get truncated by chat apps: offer Copy as text only. */
export function isShareLinkTooLong(link: string): boolean {
  return link.length > MAX_SHARE_LINK_LENGTH;
}

export type ShareFragmentResult =
  | { ok: true; text: string; song: Song }
  | { ok: false; reason: "empty" | "malformed" | "invalid-song" };

/** Accepts the fragment with or without the leading "#". */
export async function decodeShareFragment(fragment: string): Promise<ShareFragmentResult> {
  const payload = fragment.replace(/^#/, "").trim();
  if (!payload) return { ok: false, reason: "empty" };
  let text: string;
  try {
    text = fromUtf8(await decompress(base64UrlToBytes(payload), "deflate-raw", MAX_SONG_BYTES));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const parsed = parse(text);
  if (!parsed.ok) return { ok: false, reason: "invalid-song" };
  return { ok: true, text, song: parsed.song };
}
