// Request/reply flows on top of the sharing core (spec 3.5, 3.6): each function
// takes the transport and config so tests and the app can swap the network
// layer (testing/fakeForms.ts).

import { aggregateBoard, buildCloseFields, buildJoinFields, buildOpenFields, buildReportFields, type BoardRequest, type RequestInput } from "./requests.js";
import { fetchCsvRecords, submitToForm, type SharingTransport } from "./transport.js";
import type { SharingConfig } from "./config.js";
import { findDuplicateRequests } from "./matching.js";
import { getOrCreateIdentity, listIdentities } from "./identity.js";
import { getMyRequest, listHiddenReplies, listMyRequests, markMyRequestClosed, saveMyRequest, type MyRequest } from "./myRequests.js";
import { buildReplyRows, collectMyReplies, type MyReply } from "./replies.js";

export interface SharingDeps {
  transport: SharingTransport;
  config: SharingConfig;
}

export function fetchBoard(deps: SharingDeps): Promise<BoardRequest[]> {
  return fetchCsvRecords(deps.transport, deps.config.boardCsv).then(aggregateBoard);
}

/** Open (not closed) requests, newest last in sheet order reversed so the newest comes first. */
export function openRequests(board: BoardRequest[]): BoardRequest[] {
  return board.filter((r) => !r.closed).reverse();
}

export function duplicatesOf(board: BoardRequest[], input: { title: string; artist: string }) {
  return findDuplicateRequests(board, input);
}

export async function postOpenRequest(deps: SharingDeps, input: RequestInput): Promise<MyRequest> {
  const identity = await getOrCreateIdentity();
  const open = await buildOpenFields(input, identity);
  await submitToForm(deps.transport, deps.config, "requests", open.fields);
  const f = open.fields;
  const mine: MyRequest = {
    requestId: open.requestId,
    title: f.title!,
    artist: f.artist!,
    part: input.part,
    ...(f.youtubeUrl ? { youtubeUrl: f.youtubeUrl } : {}),
    keyId: identity.keyId,
    closeSecret: open.closeSecret,
    createdAt: new Date().toISOString(),
    closed: false,
  };
  await saveMyRequest(mine);
  return mine;
}

/** Joins an existing request. It is remembered locally (without a close secret) so its replies show up. */
export async function postJoinRequest(deps: SharingDeps, request: BoardRequest, displayName = ""): Promise<MyRequest> {
  const identity = await getOrCreateIdentity();
  await submitToForm(deps.transport, deps.config, "requests", buildJoinFields(request.requestId, identity, displayName));
  const mine: MyRequest = {
    requestId: request.requestId,
    title: request.title,
    artist: request.artist,
    part: request.part,
    ...(request.youtubeUrl ? { youtubeUrl: request.youtubeUrl } : {}),
    keyId: identity.keyId,
    closeSecret: "",
    createdAt: new Date().toISOString(),
    closed: false,
  };
  await saveMyRequest(mine);
  return mine;
}

export async function postCloseRequest(deps: SharingDeps, requestId: string): Promise<void> {
  const mine = await getMyRequest(requestId);
  if (!mine || !mine.closeSecret) throw new Error("Only the person who opened a request can close it.");
  await submitToForm(deps.transport, deps.config, "requests", buildCloseFields(requestId, mine.closeSecret));
  await markMyRequestClosed(requestId);
}

export function postReport(deps: SharingDeps, requestId: string, reason: string): Promise<void> {
  return submitToForm(deps.transport, deps.config, "report", buildReportFields(requestId, reason));
}

/** Encrypts once per member key and posts one row each. Returns the number of people it was sent to. */
export async function postShare(
  deps: SharingDeps,
  request: BoardRequest,
  songText: string,
  opts: { displayName?: string; note?: string } = {},
): Promise<number> {
  const name = opts.displayName?.trim();
  const note = opts.note?.trim();
  const rows = await buildReplyRows(request.requestId, request.members, {
    songText,
    sentAt: new Date().toISOString(),
    ...(name ? { displayName: name } : {}),
    ...(note ? { note } : {}),
  });
  for (const row of rows) await submitToForm(deps.transport, deps.config, "replies", { ...row });
  return rows.length;
}

/** Fetches the replies CSV and returns this device's decryptable, non-hidden replies. */
export async function fetchMyReplies(deps: SharingDeps): Promise<MyReply[]> {
  const identities = await listIdentities();
  if (identities.length === 0) return [];
  const rows = await fetchCsvRecords(deps.transport, deps.config.repliesCsv);
  const [replies, hidden] = await Promise.all([
    collectMyReplies(rows, identities.map((i) => ({ keyId: i.keyId, privateKey: i.privateKey }))),
    listHiddenReplies(),
  ]);
  return replies.filter((r) => !hidden.includes(r.replyId));
}

export { listMyRequests };
