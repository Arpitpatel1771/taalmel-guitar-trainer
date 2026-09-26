import { describe, expect, it } from "vitest";
import { createYouTubePlayer, errorMessageForYouTubeErrorCode, loadYouTubeApi } from "./youtube";

describe("errorMessageForYouTubeErrorCode", () => {
  it("gives a readable message for each documented YouTube error code", () => {
    expect(errorMessageForYouTubeErrorCode(2)).toMatch(/invalid/i);
    expect(errorMessageForYouTubeErrorCode(5)).toMatch(/html5/i);
    expect(errorMessageForYouTubeErrorCode(100)).toMatch(/not found/i);
    expect(errorMessageForYouTubeErrorCode(101)).toMatch(/owner/i);
    expect(errorMessageForYouTubeErrorCode(150)).toMatch(/owner/i);
  });

  it("falls back to a generic readable message for unknown codes", () => {
    expect(errorMessageForYouTubeErrorCode(999)).toContain("999");
  });
});

describe("loadYouTubeApi / createYouTubePlayer outside a browser environment", () => {
  // These tests run in Vitest's "node" environment (vite.config.ts), where
  // `window`/`document` are undefined -- exactly the environment guard
  // loadYouTubeApi is meant to handle gracefully instead of crashing.
  it("rejects with a readable message when there is no window/document", async () => {
    expect(typeof window).toBe("undefined");
    await expect(loadYouTubeApi()).rejects.toThrow(/browser environment/i);
  });

  it("createYouTubePlayer propagates the same readable rejection", async () => {
    await expect(createYouTubePlayer({} as HTMLElement, "abc123")).rejects.toThrow(
      /browser environment/i,
    );
  });
});
