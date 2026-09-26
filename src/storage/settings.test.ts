import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../model/index.js";
import { loadSettings, requestPersist, saveSettings } from "./settings.js";
import { resetTaalmelDb } from "./testSetup.js";

afterEach(async () => {
  await resetTaalmelDb();
});

describe("loadSettings", () => {
  it("returns DEFAULT_SETTINGS when nothing has been saved", async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
  });

  it("round-trips saved settings", async () => {
    const custom = {
      ...DEFAULT_SETTINGS,
      zoom: 400,
      lanes: { ...DEFAULT_SETTINGS.lanes, teacher: true },
    };
    await saveSettings(custom);
    expect(await loadSettings()).toEqual(custom);
  });

  it("merges a partial stored record with defaults (forward compatibility)", async () => {
    // Simulate an older stored settings record missing newer fields, by
    // saving a value that itself omits some nested fields.
    const partial = { ...DEFAULT_SETTINGS, zoom: 300 } as typeof DEFAULT_SETTINGS;
    // @ts-expect-error intentionally incomplete to exercise the merge path
    delete partial.countIn;
    await saveSettings(partial);
    const loaded = await loadSettings();
    expect(loaded.zoom).toBe(300);
    expect(loaded.countIn).toBe(DEFAULT_SETTINGS.countIn);
  });

  it("drops a stale accidentals field from a previously saved record", async () => {
    // Simulate a settings record saved before `accidentals` was removed from
    // Settings in favor of per-note flat metadata.
    const stale = { ...DEFAULT_SETTINGS, accidentals: "flats" };
    await saveSettings(stale as unknown as typeof DEFAULT_SETTINGS);
    const loaded = await loadSettings();
    expect(loaded).toEqual(DEFAULT_SETTINGS);
    expect(loaded).not.toHaveProperty("accidentals");
  });
});

describe("requestPersist", () => {
  it("resolves to a boolean without throwing", async () => {
    const result = await requestPersist();
    expect(typeof result).toBe("boolean");
  });
});
