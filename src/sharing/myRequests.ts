// Local "my requests" store: the requests this device opened, with the close
// secret that only the requester knows, plus locally hidden replies.

import { META_STORE, REQUESTS_STORE, openSharingDb, reqP, txP } from "./identity.js";
import type { RequestPart } from "./requests.js";

export interface MyRequest {
  requestId: string;
  title: string;
  artist: string;
  part: RequestPart;
  youtubeUrl?: string;
  keyId: string;
  closeSecret: string;
  createdAt: string;
  closed: boolean;
}

export async function saveMyRequest(req: MyRequest): Promise<void> {
  const db = await openSharingDb();
  const tx = db.transaction(REQUESTS_STORE, "readwrite");
  tx.objectStore(REQUESTS_STORE).put(req);
  await txP(tx);
}

export async function getMyRequest(requestId: string): Promise<MyRequest | undefined> {
  const db = await openSharingDb();
  return (await reqP(db.transaction(REQUESTS_STORE).objectStore(REQUESTS_STORE).get(requestId))) as MyRequest | undefined;
}

/** Newest first. */
export async function listMyRequests(): Promise<MyRequest[]> {
  const db = await openSharingDb();
  const all = (await reqP(db.transaction(REQUESTS_STORE).objectStore(REQUESTS_STORE).getAll())) as MyRequest[];
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function markMyRequestClosed(requestId: string): Promise<void> {
  const existing = await getMyRequest(requestId);
  if (existing) await saveMyRequest({ ...existing, closed: true });
}

export async function deleteMyRequest(requestId: string): Promise<void> {
  const db = await openSharingDb();
  const tx = db.transaction(REQUESTS_STORE, "readwrite");
  tx.objectStore(REQUESTS_STORE).delete(requestId);
  await txP(tx);
}

const HIDDEN_KEY = "hiddenReplies";

export async function listHiddenReplies(): Promise<string[]> {
  const db = await openSharingDb();
  return ((await reqP(db.transaction(META_STORE).objectStore(META_STORE).get(HIDDEN_KEY))) as string[] | undefined) ?? [];
}

/** `replyId` comes from replies.ts. */
export async function hideReply(replyId: string): Promise<void> {
  const hidden = await listHiddenReplies();
  if (hidden.includes(replyId)) return;
  const db = await openSharingDb();
  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put([...hidden, replyId], HIDDEN_KEY);
  await txP(tx);
}
