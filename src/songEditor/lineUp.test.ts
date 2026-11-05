import { describe, expect, it } from "vitest";
import { lineUpOffset } from "./lineUp";

describe("lineUpOffset", () => {
  it("is the video time minus the playhead time", () => {
    expect(lineUpOffset(75.25, 3.25)).toBe(72);
  });
  it("is 0 when both are at the same time", () => {
    expect(lineUpOffset(2, 2)).toBe(0);
  });
  it("rounds to milliseconds", () => {
    expect(lineUpOffset(10.00049, 0)).toBe(10);
  });
  it("refuses a negative offset", () => {
    expect(lineUpOffset(1, 4)).toBeNull();
  });
});
