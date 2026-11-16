import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BottomSheet, isTopSheet, pushSheet, shouldCloseOnSwipe } from "./BottomSheet";

describe("BottomSheet", () => {
  it("renders nothing when closed", () => {
    expect(renderToStaticMarkup(<BottomSheet open={false} onClose={() => {}} title="T">x</BottomSheet>)).toBe("");
  });
  it("closes on a downward swipe of more than 80 px only", () => {
    expect(shouldCloseOnSwipe(81)).toBe(true);
    expect(shouldCloseOnSwipe(80)).toBe(false);
    expect(shouldCloseOnSwipe(-200)).toBe(false);
  });
});

describe("sheet stack", () => {
  it("only the most recently opened sheet is on top", () => {
    const a = {};
    const b = {};
    const offA = pushSheet(a);
    const offB = pushSheet(b);
    expect(isTopSheet(b)).toBe(true);
    expect(isTopSheet(a)).toBe(false);
    offB();
    expect(isTopSheet(a)).toBe(true);
    offA();
    expect(isTopSheet(a)).toBe(false);
  });
});
