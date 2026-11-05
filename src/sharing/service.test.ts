import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { createFakeForms } from "./testing/fakeForms.js";
import { duplicatesOf, fetchBoard, fetchMyReplies, openRequests, postCloseRequest, postJoinRequest, postOpenRequest, postReport, postShare } from "./service.js";
import { hideReply, listMyRequests } from "./myRequests.js";
import { parse } from "../songFormat/index.js";
import { SAMPLE_SONGS } from "../samples/index.js";

describe("request -> reply -> hide -> close flow", () => {
  it("runs end to end on the fake forms", async () => {
    const fake = createFakeForms();
    const deps = { transport: fake.transport, config: fake.config };

    const mine = await postOpenRequest(deps, { title: "Karz theme", artist: "Laxmikant-Pyarelal", part: "whole" });
    expect(await listMyRequests()).toHaveLength(1);

    let board = await fetchBoard(deps);
    expect(openRequests(board)).toHaveLength(1);
    expect(duplicatesOf(board, { title: "karz theme", artist: "Laxmikant Pyarelal" })).toHaveLength(1);

    const text = SAMPLE_SONGS[0]!.text;
    expect(parse(text).ok).toBe(true);
    const sent = await postShare(deps, board[0]!, text, { displayName: "Sam", note: "capo 2" });
    expect(sent).toBe(1);

    const replies = await fetchMyReplies(deps);
    expect(replies).toHaveLength(1);
    expect(replies[0]!.requestId).toBe(mine.requestId);
    expect(replies[0]!.payload.displayName).toBe("Sam");

    await hideReply(replies[0]!.replyId);
    expect(await fetchMyReplies(deps)).toHaveLength(0);

    await postReport(deps, mine.requestId, "spam");
    expect(fake.rows.report).toHaveLength(1);

    await postCloseRequest(deps, mine.requestId);
    board = await fetchBoard(deps);
    expect(openRequests(board)).toHaveLength(0);
    expect((await listMyRequests())[0]!.closed).toBe(true);
  });

  it("join adds a member and cannot be closed", async () => {
    const fake = createFakeForms();
    const deps = { transport: fake.transport, config: fake.config };
    await postOpenRequest(deps, { title: "Song A", artist: "Band", part: "solo" });
    const board = await fetchBoard(deps);
    const joined = await postJoinRequest(deps, board[0]!);
    expect(joined.closeSecret).toBe("");
    await expect(postCloseRequest(deps, board[0]!.requestId.replace(/.$/, "0"))).rejects.toThrow();
  });
});
