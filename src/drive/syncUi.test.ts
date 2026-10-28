import { describe, expect, it } from "vitest";
import type { SyncStatus } from "./engine";
import { chipFor, clipBadge, relativeTime } from "./syncUi";

const base: SyncStatus = { state: "idle", email: null, lastSyncAt: null, conflicts: [], pendingRemoteDeletes: [], uploads: {}, error: null };
const blob = new Blob(["x"]);

describe("chipFor", () => {
  it("maps states to spec texts", () => {
    expect(chipFor({ ...base, state: "disconnected" })).toBeNull();
    expect(chipFor(base)).toMatchObject({ text: "Synced", tone: "ok" });
    expect(chipFor({ ...base, state: "syncing" })?.text).toBe("Syncing…");
    expect(chipFor({ ...base, state: "offline" })?.text).toBe("Offline — saved locally");
    expect(chipFor({ ...base, state: "authRequired" })).toMatchObject({ text: "Drive: sign in to resume", action: "connect" });
    expect(chipFor({ ...base, state: "retrying" })?.text).toBe("Retrying");
    expect(chipFor({ ...base, state: "driveFull" })?.text).toBe("Drive full — uploads paused");
  });
  it("shows conflicts when idle", () => {
    const c = { songId: "a" } as SyncStatus["conflicts"][number];
    expect(chipFor({ ...base, conflicts: [c, c] })).toMatchObject({ text: "2 conflicts", action: "conflicts" });
    expect(chipFor({ ...base, conflicts: [c] })?.text).toBe("1 conflict");
  });
});

describe("clipBadge", () => {
  it("follows the badge rules", () => {
    expect(clipBadge({ id: "a", blob: null, driveFileId: "f" }, {}).text).toBe("In Drive · not downloaded");
    expect(clipBadge({ id: "a", blob: null }, {}).text).toBe("Not uploaded (on another device)");
    expect(clipBadge({ id: "a", blob, driveFileId: "f" }, {}).text).toBe("In Drive");
    expect(clipBadge({ id: "a", blob }, { a: 0.426 }).text).toBe("Uploading 43%");
    expect(clipBadge({ id: "a", blob }, {}).text).toBe("This device only");
  });
});

describe("relativeTime", () => {
  it("formats", () => {
    expect(relativeTime(1000, 5000)).toBe("just now");
    expect(relativeTime(0, 5 * 60000)).toBe("5 min ago");
    expect(relativeTime(0, 3 * 3600000)).toBe("3 h ago");
  });
});
