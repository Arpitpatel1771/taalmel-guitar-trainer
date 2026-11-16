import { describe, expect, it } from "vitest";
import { COMPACT_QUERY, PHONE_QUERY, matchesQuery, subscribeQuery } from "./compact";

describe("compact detection", () => {
  it("is false without matchMedia", () => expect(matchesQuery(COMPACT_QUERY, undefined)).toBe(false));
  it("reads the query", () => expect(matchesQuery(COMPACT_QUERY, () => ({ matches: true }))).toBe(true));
  it("reports live changes (rotation) and unsubscribes", () => {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    const mm = () => ({
      matches: false,
      addEventListener: (_: string, l: never) => listeners.add(l),
      removeEventListener: (_: string, l: never) => listeners.delete(l),
    });
    const seen: boolean[] = [];
    const off = subscribeQuery(COMPACT_QUERY, (m) => seen.push(m), mm as never);
    listeners.forEach((l) => l({ matches: true }));
    off();
    expect(seen).toEqual([true]);
    expect(listeners.size).toBe(0);
  });
  it("compact query covers narrow screens and touch tablets", () => {
    expect(COMPACT_QUERY).toContain("max-width: 899.98px");
    expect(COMPACT_QUERY).toContain("(hover: none) and (pointer: coarse)");
    expect(PHONE_QUERY).toBe("(max-width: 599.98px)");
  });
});
