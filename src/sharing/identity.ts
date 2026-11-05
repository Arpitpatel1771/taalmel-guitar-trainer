// Identity keys (spec 3.2): ECDH P-256 pair, keyId, JWK export/import, and
// IndexedDB storage in a small database of its own ("taalmel-sharing") so the
// main `taalmel` schema is untouched.

import { bytesToHex, sha256, base64ToBytes, bytesToBase64, utf8, fromUtf8 } from "./encoding.js";

const DB_NAME = "taalmel-sharing";
const DB_VERSION = 1;
export const KEYS_STORE = "keys";
export const META_STORE = "meta";
export const REQUESTS_STORE = "myRequests";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openSharingDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(KEYS_STORE)) db.createObjectStore(KEYS_STORE, { keyPath: "keyId" });
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE);
      if (!db.objectStoreNames.contains(REQUESTS_STORE)) db.createObjectStore(REQUESTS_STORE, { keyPath: "requestId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB database 'taalmel-sharing'"));
    req.onblocked = () => reject(new Error("Opening IndexedDB database 'taalmel-sharing' is blocked"));
  });
  return dbPromise;
}

export function reqP<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

export function txP(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Test-only: forget the cached connection (call after closing it). */
export function _resetSharingDbForTests(): void {
  const p = dbPromise;
  dbPromise = null;
  void p?.then((db) => db.close()).catch(() => {});
}

const ECDH = { name: "ECDH", namedCurve: "P-256" } as const;

export interface Identity {
  keyId: string;
  publicKeyJwk: JsonWebKey;
  privateKeyJwk: JsonWebKey;
  createdAt: string;
}

export interface LoadedIdentity extends Identity {
  privateKey: CryptoKey;
}

/** First 16 bytes (hex) of SHA-256 over the raw (uncompressed point) public key. */
export async function keyIdOf(publicKey: CryptoKey): Promise<string> {
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  return bytesToHex((await sha256(raw)).subarray(0, 16));
}

export async function keyIdOfJwk(publicJwk: JsonWebKey): Promise<string> {
  return keyIdOf(await importPublicKeyJwk(publicJwk));
}

function publicPart(jwk: JsonWebKey): JsonWebKey {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, ext: true };
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y) throw new Error("Not a P-256 public key");
  return crypto.subtle.importKey("jwk", publicPart(jwk), ECDH, true, []);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  if (jwk.kty !== "EC" || jwk.crv !== "P-256" || !jwk.x || !jwk.y || !jwk.d) throw new Error("Not a P-256 private key");
  return crypto.subtle.importKey("jwk", { ...jwk, key_ops: undefined, ext: true }, ECDH, true, ["deriveBits"]);
}

export async function generateIdentity(): Promise<Identity> {
  const pair = await crypto.subtle.generateKey(ECDH, true, ["deriveBits"]);
  const privateKeyJwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKeyJwk = publicPart(await crypto.subtle.exportKey("jwk", pair.publicKey));
  return { keyId: await keyIdOf(pair.publicKey), publicKeyJwk, privateKeyJwk, createdAt: new Date().toISOString() };
}

/** Public key JWK as the requests-form `publicKey` field: base64(JSON). */
export function encodePublicKeyField(jwk: JsonWebKey): string {
  return bytesToBase64(utf8(JSON.stringify(publicPart(jwk))));
}

export function decodePublicKeyField(field: string): JsonWebKey {
  const jwk = JSON.parse(fromUtf8(base64ToBytes(field))) as JsonWebKey;
  if (typeof jwk !== "object" || jwk === null) throw new Error("Bad public key");
  return jwk;
}

async function putIdentity(id: Identity, makeActive: boolean): Promise<void> {
  const db = await openSharingDb();
  const tx = db.transaction([KEYS_STORE, META_STORE], "readwrite");
  tx.objectStore(KEYS_STORE).put(id);
  if (makeActive) tx.objectStore(META_STORE).put(id.keyId, "activeKeyId");
  await txP(tx);
}

async function toLoaded(id: Identity): Promise<LoadedIdentity> {
  return { ...id, privateKey: await importPrivateKeyJwk(id.privateKeyJwk) };
}

/** All stored identities (the active one plus any imported/older ones), for decrypting replies. */
export async function listIdentities(): Promise<LoadedIdentity[]> {
  const db = await openSharingDb();
  const all = (await reqP(db.transaction(KEYS_STORE).objectStore(KEYS_STORE).getAll())) as Identity[];
  return Promise.all(all.map(toLoaded));
}

/** The identity used for new requests; creates one on first use. */
export async function getOrCreateIdentity(): Promise<LoadedIdentity> {
  const db = await openSharingDb();
  const activeId = (await reqP(db.transaction(META_STORE).objectStore(META_STORE).get("activeKeyId"))) as string | undefined;
  if (activeId) {
    const rec = (await reqP(db.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(activeId))) as Identity | undefined;
    if (rec) return toLoaded(rec);
  }
  const fresh = await generateIdentity();
  await putIdentity(fresh, true);
  return toLoaded(fresh);
}

/** Private key as JWK, for backing up in Drive-synced settings. Creates an identity if none exists. */
export async function exportPrivateKeyJwk(): Promise<JsonWebKey> {
  return (await getOrCreateIdentity()).privateKeyJwk;
}

/**
 * Restores a private key (e.g. from synced settings). It is added to the key
 * ring so replies for it can be read; it becomes the active key only when
 * `makeActive` is set or no key exists yet. Returns its keyId. Throws on an
 * invalid key.
 */
export async function importPrivateKeyBackup(jwk: JsonWebKey, makeActive = false): Promise<string> {
  const priv = await importPrivateKeyJwk(jwk);
  const full = await crypto.subtle.exportKey("jwk", priv);
  const publicKeyJwk = publicPart(full);
  const keyId = await keyIdOfJwk(publicKeyJwk);
  const db = await openSharingDb();
  const hasActive = Boolean(await reqP(db.transaction(META_STORE).objectStore(META_STORE).get("activeKeyId")));
  const existing = (await reqP(db.transaction(KEYS_STORE).objectStore(KEYS_STORE).get(keyId))) as Identity | undefined;
  await putIdentity(
    existing ?? { keyId, publicKeyJwk, privateKeyJwk: full, createdAt: new Date().toISOString() },
    makeActive || !hasActive,
  );
  return keyId;
}
