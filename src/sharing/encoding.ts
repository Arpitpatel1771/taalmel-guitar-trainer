// Byte/base64/compression helpers shared by sharing modules (browser APIs only).

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** Throws on invalid base64. */
export function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.trim());
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("Invalid base64url");
  let b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return base64ToBytes(b64);
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function utf8(s: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(s);
}

export function fromUtf8(b: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: true }).decode(b);
}

export async function sha256(data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data));
}

export async function sha256Hex(text: string): Promise<string> {
  return bytesToHex(await sha256(utf8(text)));
}

async function pipe(data: Uint8Array<ArrayBuffer>, stream: { writable: WritableStream; readable: ReadableStream }, maxBytes?: number) {
  const writer = stream.writable.getWriter();
  const done = writer.write(data).then(() => writer.close());
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done: fin } = await reader.read();
      if (fin) break;
      total += value.length;
      if (maxBytes !== undefined && total > maxBytes) {
        await reader.cancel();
        throw new Error("Decompressed data too large");
      }
      chunks.push(value);
    }
    await done;
  } catch (err) {
    done.catch(() => {});
    throw err;
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export type CompressionFormat = "gzip" | "deflate-raw";

export function compress(data: Uint8Array<ArrayBuffer>, format: CompressionFormat): Promise<Uint8Array> {
  return pipe(data, new CompressionStream(format));
}

export function decompress(data: Uint8Array<ArrayBuffer>, format: CompressionFormat, maxBytes = 1_000_000): Promise<Uint8Array> {
  return pipe(data, new DecompressionStream(format), maxBytes);
}
