import { describe, expect, it } from "vitest";
import { hintsAvailable } from "./hintsAvailable";

describe("hintsAvailable", () => {
  it("is on when the browser can share a tab's audio", () => expect(hintsAvailable({ mediaDevices: { getDisplayMedia: () => undefined } })).toBe(true));
  it("is off without getDisplayMedia, whatever the device", () => {
    expect(hintsAvailable({ mediaDevices: {} })).toBe(false);
    expect(hintsAvailable({})).toBe(false);
    expect(hintsAvailable(undefined)).toBe(false);
  });
});
