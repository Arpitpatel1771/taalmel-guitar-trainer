import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("installable (specs/8-11-mobile.md §5)", () => {
  it("has a manifest whose icons exist, a maskable icon, and no service worker", () => {
    const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
    expect(m).toMatchObject({ name: "Taalmel", start_url: "/", display: "standalone" });
    for (const i of m.icons) expect(existsSync(`public${i.src}`)).toBe(true);
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
    const html = readFileSync("index.html", "utf8");
    expect(html).toContain("viewport-fit=cover");
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).not.toMatch(/serviceWorker/);
  });
});
