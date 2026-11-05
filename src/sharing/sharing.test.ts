import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import {
  aggregateBoard,
  buildCloseFields,
  buildJoinFields,
  buildOpenFields,
  buildReplyRows,
  collectMyReplies,
  csvToRecords,
  decodeShareFragment,
  decryptReply,
  encodeShareLink,
  encryptReply,
  exportPrivateKeyJwk,
  fetchCsvRecords,
  findDuplicateRequests,
  generateIdentity,
  getOrCreateIdentity,
  importPrivateKeyJwk as importPrivateKey,
  importPrivateKeyBackup,
  isShareLinkTooLong,
  libraryUpdateAvailable,
  listIdentities,
  listMyRequests,
  matchRequestsToSongs,
  normalizeText,
  parseCsv,
  parseFormEntries,
  parseLibraryIndex,
  getSharingConfig,
  isSharingConfigured,
  ReplyTooLargeError,
  replyId,
  saveMyRequest,
  submitToForm,
  tokenOverlap,
  hideReply,
  listHiddenReplies,
  type BoardRequest,
} from "./index.js";
import { createFakeForms } from "./testing/fakeForms.js";

const SONG = readFileSync("public/library/twinkle-twinkle.txt", "utf8");

describe("config", () => {
  it("reads env and entries", () => {
    expect(isSharingConfigured({})).toBe(false);
    const env = {
      VITE_REQUESTS_FORM: "a",
      VITE_BOARD_CSV: "b",
      VITE_REPLIES_FORM: "c",
      VITE_REPLIES_CSV: "d",
      VITE_REPORT_FORM: "e",
      VITE_FORM_ENTRIES: JSON.stringify({ requests: { title: "entry.1" }, junk: 1 }),
    };
    expect(isSharingConfigured(env)).toBe(true);
    expect(getSharingConfig(env).entries.requests.title).toBe("entry.1");
    expect(parseFormEntries("not json").replies).toEqual({});
  });
});

describe("csv", () => {
  it("handles quotes, commas, newlines, CRLF and BOM", () => {
    const text = '﻿a,b,c\r\n1,"x, y","line1\nline ""2"""\r\n,,\r\n';
    expect(parseCsv(text)).toEqual([["a", "b", "c"], ["1", "x, y", 'line1\nline "2"'], ["", "", ""]]);
    expect(csvToRecords("a,b\n1\n")).toEqual([{ a: "1", b: "" }]);
  });
});

describe("crypto", () => {
  it("round trips, rejects wrong key and tampering", async () => {
    const me = await generateIdentity();
    const other = await generateIdentity();
    const payload = { songText: SONG, note: "hi", sentAt: "2026-11-05T00:00:00Z" };
    const enc = await encryptReply(me.publicKeyJwk, payload);
    expect(enc.recipientKeyId).toBe(me.keyId);
    expect(me.keyId).toMatch(/^[0-9a-f]{32}$/);
    const key = await importPrivateKey(me.privateKeyJwk);
    expect(await decryptReply(enc, key)).toEqual(payload);
    await expect(decryptReply(enc, await importPrivateKey(other.privateKeyJwk))).rejects.toThrow();
    const raw = Buffer.from(enc.ciphertext, "base64");
    raw[5]! ^= 1;
    await expect(decryptReply({ ...enc, ciphertext: raw.toString("base64") }, key)).rejects.toThrow();
  });

  it("rejects oversized songs", async () => {
    const me = await generateIdentity();
    const noise = Array.from({ length: 60000 }, () => Math.random().toString(36)).join("");
    await expect(encryptReply(me.publicKeyJwk, { songText: noise, sentAt: "x" })).rejects.toBeInstanceOf(ReplyTooLargeError);
  });
});

describe("identity storage", () => {
  it("creates once, exports and imports", async () => {
    const a = await getOrCreateIdentity();
    const b = await getOrCreateIdentity();
    expect(b.keyId).toBe(a.keyId);
    const jwk = await exportPrivateKeyJwk();
    const fresh = await generateIdentity();
    const id = await importPrivateKeyBackup(fresh.privateKeyJwk);
    expect(id).toBe(fresh.keyId);
    expect((await getOrCreateIdentity()).keyId).toBe(a.keyId);
    expect((await listIdentities()).map((i) => i.keyId).sort()).toEqual([a.keyId, fresh.keyId].sort());
    expect(jwk.d).toBeTruthy();
    await expect(importPrivateKeyBackup({ kty: "EC" })).rejects.toThrow();
  });

  it("stores my requests and hidden replies", async () => {
    await saveMyRequest({ requestId: "r1", title: "T", artist: "A", part: "whole", keyId: "k", closeSecret: "s", createdAt: "2026-01-01", closed: false });
    expect((await listMyRequests()).some((r) => r.requestId === "r1")).toBe(true);
    await hideReply("x:y");
    expect(await listHiddenReplies()).toContain("x:y");
  });
});

describe("board aggregation", () => {
  it("handles open, joins, closes and junk", async () => {
    const a = await generateIdentity();
    const b = await generateIdentity();
    const c = await generateIdentity();
    const open = await buildOpenFields({ title: "Karz Theme", artist: "L-P", part: "whole" }, a);
    const other = await buildOpenFields({ title: "Other", artist: "X", part: "solo", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" }, c);
    const rows = [
      open.fields,
      buildJoinFields(open.requestId, b, "Bee"),
      buildJoinFields(open.requestId, b), // duplicate key
      buildJoinFields("missing", b), // unknown request
      { ...buildJoinFields(open.requestId, a), publicKey: "garbage" },
      { action: "open", requestId: "bad" },
      other.fields,
      buildCloseFields(other.requestId, "wrong-secret"),
      { action: "wat" },
    ];
    let board = await aggregateBoard(rows);
    expect(board).toHaveLength(2);
    expect(board[0]).toMatchObject({ title: "Karz Theme", memberCount: 2, closed: false });
    expect(board[1]).toMatchObject({ closed: false, youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    board = await aggregateBoard([...rows, buildCloseFields(other.requestId, other.closeSecret)]);
    expect(board[1]!.closed).toBe(true);
    expect(board[0]!.members.map((m) => m.keyId)).toContain(b.keyId);
  });

  it("validates input", async () => {
    const a = await generateIdentity();
    await expect(buildOpenFields({ title: " ", artist: "x", part: "whole" }, a)).rejects.toThrow();
    await expect(buildOpenFields({ title: "t", artist: "x", part: "whole", note: "n".repeat(301) }, a)).rejects.toThrow();
    await expect(buildOpenFields({ title: "t", artist: "x", part: "whole", youtubeUrl: "http://x.com" }, a)).rejects.toThrow();
  });
});

describe("matching", () => {
  it("normalizes", () => {
    expect(normalizeText("  Café  del Mar!! ")).toBe("cafe del mar");
  });
  it("scores near-duplicates and avoids false positives", () => {
    expect(tokenOverlap("The Karz Theme", "karz theme")).toBe(1);
    expect(tokenOverlap("Love Me Do", "Love")).toBeLessThan(0.6);
    expect(tokenOverlap("Yesterday", "Tomorrow")).toBe(0);
  });
  it("matches requests to songs and finds duplicates", () => {
    const req = (id: string, title: string, artist: string): BoardRequest => ({
      requestId: id, title, artist, part: "whole", members: [], memberCount: 1, closed: false,
    });
    const reqs = [req("1", "Karz theme", "Laxmikant"), req("2", "Hotel California", "Eagles")];
    const songs = [{ id: "s1", title: "Karz Theme" }, { id: "s2", title: "Twinkle Twinkle" }];
    const m = matchRequestsToSongs(reqs, songs);
    expect(m).toHaveLength(1);
    expect(m[0]!.song.id).toBe("s1");
    expect(findDuplicateRequests(reqs, { title: "karz  theme", artist: "Laxmikant" })).toHaveLength(1);
    expect(findDuplicateRequests(reqs, { title: "Karz theme", artist: "Someone Else" })).toHaveLength(0);
  });
});

describe("share links", () => {
  it("round trips", async () => {
    const link = await encodeShareLink(SONG, "https://taalmel.patel1771.com/");
    expect(link.startsWith("https://taalmel.patel1771.com/s#")).toBe(true);
    expect(isShareLinkTooLong(link)).toBe(false);
    const res = await decodeShareFragment(link.slice(link.indexOf("#")));
    expect(res.ok && res.text).toBe(SONG);
  });
  it("flags long links and malformed fragments", async () => {
    const noise = Array.from({ length: 20000 }, () => Math.random().toString(36)).join("");
    expect(isShareLinkTooLong(await encodeShareLink(noise, "https://x"))).toBe(true);
    expect(await decodeShareFragment("")).toEqual({ ok: false, reason: "empty" });
    expect(await decodeShareFragment("#!!!")).toEqual({ ok: false, reason: "malformed" });
    expect(await decodeShareFragment("AAAA")).toEqual({ ok: false, reason: "malformed" });
    const notSong = (await encodeShareLink("hello", "https://x")).split("#")[1]!;
    expect(await decodeShareFragment(notSong)).toEqual({ ok: false, reason: "invalid-song" });
  });
});

describe("open library", () => {
  it("parses the shipped index and skips junk", () => {
    const real = JSON.parse(readFileSync("public/library/index.json", "utf8"));
    const idx = parseLibraryIndex(real)!;
    expect(idx.songs).toHaveLength(7);
    for (const s of idx.songs) expect(readFileSync(`public/library/${s.file}`, "utf8")).toContain("title:");
    const messy = parseLibraryIndex({
      version: 1,
      songs: [
        { id: "a", title: "A", file: "a.txt", updatedAt: "2026-01-01", difficulty: "bogus" },
        { id: "a", title: "dup", file: "a.txt", updatedAt: "2026-01-01" },
        { id: "b", title: "B", file: "../x.txt", updatedAt: "2026-01-01" },
        { id: "c", title: "C", file: "c.txt", updatedAt: "nope" },
        null,
      ],
    })!;
    expect(messy.songs.map((s) => s.id)).toEqual(["a"]);
    expect(parseLibraryIndex("x")).toBeNull();
  });
  it("detects updates", () => {
    const e = { id: "a", updatedAt: "2026-02-01" };
    expect(libraryUpdateAvailable({ libraryId: "a", libraryVersion: "2026-01-01" }, e)).toBe(true);
    expect(libraryUpdateAvailable({ libraryId: "a", libraryVersion: "2026-02-01" }, e)).toBe(false);
    expect(libraryUpdateAvailable({ libraryId: "a" }, e)).toBe(true);
    expect(libraryUpdateAvailable({ libraryId: "b", libraryVersion: "2020-01-01" }, e)).toBe(false);
    expect(libraryUpdateAvailable({}, e)).toBe(false);
  });
});

describe("end to end with fake forms", () => {
  let fake: ReturnType<typeof createFakeForms>;
  beforeEach(() => {
    fake = createFakeForms();
  });

  it("request -> join -> reply -> decrypt", async () => {
    const alice = await generateIdentity();
    const bob = await generateIdentity();
    const { transport, config } = fake;

    const open = await buildOpenFields({ title: "Twinkle Twinkle Little Star", artist: "Traditional", part: "whole" }, alice);
    await submitToForm(transport, config, "requests", open.fields);
    await submitToForm(transport, config, "requests", buildJoinFields(open.requestId, bob));

    const board = await aggregateBoard(await fetchCsvRecords(transport, config.boardCsv));
    expect(board).toHaveLength(1);
    expect(board[0]!.memberCount).toBe(2);

    const payload = { songText: SONG, displayName: "Sam", sentAt: "2026-11-05T00:00:00Z" };
    const rows = await buildReplyRows(open.requestId, board[0]!.members, payload);
    expect(rows).toHaveLength(2);
    for (const r of rows) await submitToForm(transport, config, "replies", { ...r });
    await submitToForm(transport, config, "replies", { requestId: "x", recipientKeyId: bob.keyId, senderPublicKey: "z", iv: "z", ciphertext: "z" }); // junk

    const replyRows = await fetchCsvRecords(transport, config.repliesCsv);
    const aliceKey = { keyId: alice.keyId, privateKey: await importPrivateKey(alice.privateKeyJwk) };
    const got = await collectMyReplies(replyRows, [aliceKey]);
    expect(got).toHaveLength(1);
    expect(got[0]!.payload.displayName).toBe("Sam");
    expect(got[0]!.requestId).toBe(open.requestId);
    expect(got[0]!.replyId).toBe(replyId(rows[0]!));

    // A reply whose text is not a song is dropped.
    const bad = await encryptReply(alice.publicKeyJwk, { songText: "not a song", sentAt: "x" });
    await submitToForm(transport, config, "replies", { requestId: open.requestId, ...bad });
    expect(await collectMyReplies(await fetchCsvRecords(transport, config.repliesCsv), [aliceKey])).toHaveLength(1);

    // Close
    await submitToForm(transport, config, "requests", buildCloseFields(open.requestId, open.closeSecret));
    const closed = await aggregateBoard(await fetchCsvRecords(transport, config.boardCsv));
    expect(closed[0]!.closed).toBe(true);

    // Owner deletes the open row: the board forgets the request.
    fake.deleteRow("requests", 0);
    expect(await aggregateBoard(await fetchCsvRecords(transport, config.boardCsv))).toHaveLength(0);
  });

  it("offline fetch fails", async () => {
    fake.setOffline(true);
    await expect(fake.transport.fetchCsv(fake.config.boardCsv)).rejects.toThrow();
  });
});
