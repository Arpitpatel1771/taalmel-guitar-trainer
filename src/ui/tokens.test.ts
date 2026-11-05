// WCAG AA check for the token pairs of specs/5-11-ui-redesign.md 2.4. Parses
// tokens.css itself, so the CSS is the single source of truth.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

type Vars = Record<string, string>;

interface Block {
  theme: string | null;
  accent: string | null;
  vars: Vars;
}

const css = readFileSync(join(__dirname, "tokens.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every rule whose selector list is made of `:root` with optional [data-theme]/[data-accent]. */
function parseBlocks(): Block[] {
  const blocks: Block[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css))) {
    const vars: Vars = {};
    for (const d of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[d[1]] = d[2].trim();
    for (const sel of m[1].split(",").map((s) => s.trim())) {
      if (!sel.startsWith(":root")) continue;
      blocks.push({
        theme: /\[data-theme="(\w+)"\]/.exec(sel)?.[1] ?? null,
        accent: /\[data-accent="(\w+)"\]/.exec(sel)?.[1] ?? null,
        vars,
      });
    }
  }
  return blocks;
}

const BLOCKS = parseBlocks();

/** Cascade for (theme, accent): bare :root first, then more specific selectors. */
function computed(theme: string, accent: string): Vars {
  const applies = BLOCKS.filter((b) => (b.theme ?? theme) === theme && (b.accent ?? accent) === accent).sort(
    (a, b) => Number(a.theme !== null) + Number(a.accent !== null) - (Number(b.theme !== null) + Number(b.accent !== null)),
  );
  // Array.prototype.sort is stable: same-specificity blocks keep file order.
  return Object.assign({}, ...applies.map((b) => b.vars)) as Vars;
}

function hex(vars: Vars, name: string): [number, number, number] {
  const v = vars[name];
  const m = v && /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) throw new Error(`${name} is not a #rrggbb colour: ${v}`);
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = ["dark", "light"];
const ACCENTS = ["saffron", "teal", "violet"];

/** [foreground, background, minimum ratio] */
const PAIRS: [string, string, number][] = [
  ["--text", "--bg", 4.5],
  ["--text", "--surface-1", 4.5],
  ["--text-muted", "--bg", 4.5],
  ["--text-muted", "--surface-1", 4.5],
  ["--accent-text", "--bg", 4.5],
  ["--accent-text", "--surface-1", 4.5],
  ["--on-accent", "--accent", 4.5],
  // Beyond the spec's list: surfaces that carry text, and the meaning colours.
  ["--text", "--surface-2", 4.5],
  ["--text", "--pocket", 4.5],
  ["--text-muted", "--surface-2", 4.5],
  ["--text-muted", "--pocket", 4.5],
  ["--accent-text", "--accent-tint", 4.5],
  ["--accent-text", "--surface-2", 4.5],
  ["--verdict-ontime", "--sheet", 4.5],
  ["--verdict-off", "--sheet", 4.5],
  ["--ok", "--surface-1", 4.5],
  ["--warn", "--surface-1", 4.5],
  ["--record", "--record-tint", 3],
  ["--record", "--pocket", 3],
  // Large or non-essential text only (bar numbers, hints).
  ["--text-subtle", "--bg", 3],
  ["--text-subtle", "--surface-1", 3],
];

describe("tokens.css", () => {
  it("defines the spec tokens for both modes", () => {
    for (const theme of THEMES) {
      const v = computed(theme, "saffron");
      for (const name of ["--bg", "--rail", "--surface-1", "--surface-2", "--pocket", "--sheet", "--border", "--card-border", "--line", "--barline", "--text", "--text-muted", "--text-subtle", "--shadow-float", "--accent", "--on-accent", "--accent-text", "--accent-tint", "--verdict-ontime", "--verdict-off", "--ok", "--warn", "--record", "--record-tint"]) {
        expect(v[name], `${theme} ${name}`).toBeTruthy();
      }
    }
  });

  for (const theme of THEMES) {
    for (const accent of ACCENTS) {
      describe(`${theme} / ${accent}`, () => {
        const vars = computed(theme, accent);
        for (const [fg, bg, min] of PAIRS) {
          it(`${fg} on ${bg} >= ${min}:1`, () => {
            expect(contrast(hex(vars, fg), hex(vars, bg))).toBeGreaterThanOrEqual(min);
          });
        }
      });
    }
  }
});
