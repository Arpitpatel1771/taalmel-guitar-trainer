# Mobile Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a compact (phone and tablet) layout for the app shell and the Home, Songs and Library screens, while the laptop layout stays pixel-identical.

**Architecture:** A single `COMPACT_QUERY` media query decides compact mode. CSS uses the same query string, and React reads it through `useCompact()` only where the structure changes: Rail ↔ TabBar, the Pocket's floating tools ↔ Tools button + sheet, Popover ↔ BottomSheet. Every screen and all the logic is shared; compact layouts are CSS-module additions under that media query.

**Tech Stack:** Vite 8, React 19, TypeScript, CSS modules, lucide-react, Vitest. There's no DOM test environment: unit tests cover pure helpers and `renderToStaticMarkup`, and behaviour is checked in headless Chrome.

**Spec:** `specs/8-11-mobile.md` (stage 1 = §3–§7)

## Global Constraints

- Compact = `(max-width: 899.98px), (hover: none) and (pointer: coarse)`, one exported constant, repeated verbatim in CSS.
- The laptop layout (≥ 900 px with a fine pointer) must not change at all. Every compact CSS rule lives inside the compact media query.
- Tap targets in compact are at least 44 × 44 px, counting padding.
- Side gutters are 16 px in compact. There must be no horizontal page scroll.
- Text inputs use at least 16px font in compact.
- Fixed bars pad for `env(safe-area-inset-*)`. The viewport meta adds `viewport-fit=cover`.
- No service worker and no offline caching.
- Tab bar slots, in order: Home · Songs · Library · Chords · More. More holds Exercises, Recordings, Settings, the theme switch and the account chip.
- The tab bar is hidden on the `song`, `sample` and `editor` screens.
- Phone dialogs are full-screen below 600 px wide, and centred sheets from 600 px up to compact's limit.
- Repo rules (`CLAUDE.md` and the owner's preferences):
  - no git commits or pushes (the owner commits);
  - headless Chrome always runs with `--mute-audio` and is stopped after each run;
  - never touch the owner's Vite on port 5173 (use 5199);
  - all tempo shown in bpm.

## Review Focus

- **Rotating a phone or tablet** (portrait ↔ landscape) must switch the layout live without a reload. `useCompact` listens to the media query's `change` event (Task 1 test).
- **A long song title or a long account name** must not push the tab bar, a list row or the Tools chip wider than the screen. Rows truncate with an ellipsis (Task 7 smoke checks `scrollWidth <= innerWidth` with a 120-character title).
- **An open sheet when the layout switches to laptop** (a window resized past 900 px) must not leave a stuck overlay. BottomSheet closes when compact turns false (Task 2 test).
- **The software keyboard** on phones must not hide the focused search input or the request form's fields. Sticky bars use `position: sticky` (not `fixed`), and full-screen dialogs scroll (Task 7 smoke focuses the search input at 390 × 500 and checks it is visible).
- **A metronome left running** while the Tools sheet is closed must stay visible and stoppable. The live chip shows, and a tap opens the sheet (Task 4 test for chip text, Task 7 smoke for the visibility).

---

## File structure

| File | Responsibility |
| --- | --- |
| `src/ui/compact.ts` (new) | `COMPACT_QUERY`, `PHONE_QUERY`, `useCompact()`, `usePhone()` |
| `src/ui/components/BottomSheet.tsx` + `.module.css` (new) | A modal sheet from the bottom: handle, swipe/outside/Esc close, focus trap |
| `src/ui/components/Popover.tsx` | In compact, renders its panel inside BottomSheet |
| `src/ui/sharing/Dialog.tsx` + `sharing.module.css` | Full-screen on phones and a centred sheet on tablets |
| `src/ui/shell/TabBar.tsx` + `.module.css` (new) | Bottom tab bar, the More sheet, `tabForTarget()` |
| `src/ui/shell/Rail.tsx` | Exports `NAV`, `ThemeToggle` and `LONG_PRESS_MS` for reuse (no visual change) |
| `src/ui/shell/Pocket.tsx` + `.module.css` | In compact: a Tools button with a live chip and a sheet holding the same tools; `pocketChipText()` |
| `src/ui/App.tsx` | Picks Rail or TabBar; hides the tab bar on full-height screens; passes the compact flag |
| `src/ui/tokens.css`, `src/ui/styles.css` | Compact tokens (`--tabbar-h`, gutters), safe areas, tap targets, 16px inputs |
| `index.html`, `public/manifest.webmanifest`, `public/icons/*` (new) | Installability |
| `src/ui/screens/Home.module.css`, `Library.tsx` + `.module.css`, `sharing/*.module.css` | Compact list layouts |

---

### Task 1: Compact detection

**Files:**
- Create: `src/ui/compact.ts`
- Test: `src/ui/compact.test.ts`

**Interfaces:**
- Produces:
  - `export const COMPACT_QUERY = "(max-width: 899.98px), (hover: none) and (pointer: coarse)";`
  - `export const PHONE_QUERY = "(max-width: 599.98px)";`
  - `export function matchesQuery(query: string, mm?: (q: string) => { matches: boolean }): boolean`
  - `export function subscribeQuery(query: string, cb: (matches: boolean) => void, mm?: typeof window.matchMedia): () => void`
  - `export function useCompact(): boolean`
  - `export function usePhone(): boolean`

All four helpers return false or no-op when `window.matchMedia` is missing (SSR or tests). The hooks use `useSyncExternalStore` with `subscribeQuery`.

- [ ] **Step 0: Capture the laptop baseline before any UI change.** Write the screenshot part of `scripts/smoke-mobile.mjs` first (Task 7 has the details) and save 1440 × 1000 screenshots of Home, Songs and Library in dark and light to `<scratchpad>/mobile-baseline/`. Task 7 compares against these.
- [ ] **Step 1: Write the failing tests**

```ts
it("is false without matchMedia", () => expect(matchesQuery(COMPACT_QUERY, undefined)).toBe(false));
it("reads the query", () => expect(matchesQuery(COMPACT_QUERY, () => ({ matches: true }))).toBe(true));
it("reports live changes (rotation) and unsubscribes", () => {
  const listeners = new Set<(e: { matches: boolean }) => void>();
  const mm = () => ({ matches: false, addEventListener: (_: string, l: never) => listeners.add(l), removeEventListener: (_: string, l: never) => listeners.delete(l) });
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
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/compact.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement `src/ui/compact.ts`** with the interfaces above.
- [ ] **Step 4: Run** the same command. Expected: PASS.

### Task 2: BottomSheet, plus Popover and Dialog in compact

**Files:**
- Create: `src/ui/components/BottomSheet.tsx`, `src/ui/components/BottomSheet.module.css`
- Modify: `src/ui/components/Popover.tsx`, `src/ui/sharing/Dialog.tsx`, `src/ui/sharing/sharing.module.css`
- Test: `src/ui/components/BottomSheet.test.tsx`

**Interfaces:**
- Consumes: `useCompact`, `usePhone` (Task 1)
- Produces: `export function BottomSheet(props: { open: boolean; onClose: () => void; title: string; children: ReactNode }): JSX.Element | null`
  - Renders through a portal to `document.body`, with `role="dialog"`, `aria-modal="true"`, `aria-label={title}`.
  - Has a scrim (a tap on it closes the sheet) and a drag handle (a downward swipe of more than 80 px closes it).
  - Esc closes it. Focus moves into the sheet on open and back to the opener on close, and Tab cycles inside the sheet.
  - Max height is `85dvh`, and the content scrolls.
  - Bottom padding is `env(safe-area-inset-bottom)`.
  - If `useCompact()` turns false while the sheet is open, it calls `onClose()` (Review Focus).
- `Popover` keeps its props. In compact it renders its trigger as before and its panel inside `BottomSheet` (title = `label`), and the `width`, `placement` and `align` props are ignored there.
- `Dialog` keeps its props. Under `PHONE_QUERY` it takes the full screen (100dvw × 100dvh, header with a back arrow that calls `onClose`). From 600 px up to compact's limit it is a centred sheet (max-width 560 px, max-height 90dvh). Laptop is unchanged.

- [ ] **Step 1: Write the failing test** (static markup, since there's no DOM env):

```tsx
it("renders nothing when closed", () => expect(renderToStaticMarkup(<BottomSheet open={false} onClose={() => {}} title="T">x</BottomSheet>)).toBe(""));
it("exports a pure swipe rule", () => {
  expect(shouldCloseOnSwipe(81)).toBe(true);
  expect(shouldCloseOnSwipe(80)).toBe(false);
  expect(shouldCloseOnSwipe(-200)).toBe(false);
});
```

Also export `shouldCloseOnSwipe(dyPx: number): boolean` (closes when `dyPx > 80`).
- [ ] **Step 2: Run** `npx vitest run src/ui/components/BottomSheet.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement BottomSheet**, then the Popover and Dialog compact branches.
- [ ] **Step 4: Run** the test, `npx tsc -b` and `npx vitest run`. Expected: all PASS.
- [ ] **Step 5: Browser check** (port 5199, muted, at 390 × 844). Open Songs, then a card's `⋯`. A sheet appears from the bottom. Esc and a tap on the scrim each close it. At 1440 the same `⋯` still opens the old popover. Stop Chrome and Vite.

### Task 3: Tab bar and the More sheet

**Files:**
- Create: `src/ui/shell/TabBar.tsx`, `src/ui/shell/TabBar.module.css`
- Modify: `src/ui/shell/Rail.tsx` (export `NAV`, extract `ThemeToggle` and keep the rail rendering it identically), `src/ui/App.tsx:179-188, 414-439`, `src/ui/shell/Shell.module.css`
- Test: `src/ui/shell/TabBar.test.ts`

**Interfaces:**
- Consumes: `NavTarget` and `NAV` (Rail), `BottomSheet` (Task 2), `useCompact` (Task 1)
- Produces:
  - `export type TabSlot = "home" | "library" | "shared" | "chords" | "more";`
  - `export function tabForTarget(active: NavTarget | null): TabSlot | null`: `exercises`, `recorder` and `settings` map to `"more"`, the other targets map to themselves, and `null` stays `null`.
  - `export function hidesTabBar(screenKind: string): boolean`: true for `"song"`, `"sample"` and `"editor"`.
  - `export function TabBar(props: { active: NavTarget | null; onNavigate: (t: NavTarget) => void; theme: ThemePref; resolvedDark: boolean; onThemeChange: (t: ThemePref) => void; account?: ReactNode }): JSX.Element`
- The bar is fixed at the bottom with height `--tabbar-h: 64px` plus `env(safe-area-inset-bottom)`. Each slot is an icon above a label and at least 44 px tall.
- More opens a BottomSheet titled "More" containing Exercises, Recordings and Settings as rows, then the ThemeToggle row, then the account chip.
- In `App.tsx`:
  - in compact, render `TabBar` instead of `Rail`, unless `hidesTabBar(screen.kind)`, in which case render nothing there;
  - `main` gets `padding-bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom))` when the bar shows.
- On `song`, `sample` and `editor`, the existing back buttons ("Back to library", "Songs") must be visible and at least 44 px in compact. Check them; there's no new component.

- [ ] **Step 1: Write the failing tests**

```ts
it("maps every target to a slot", () => {
  expect(tabForTarget("home")).toBe("home");
  expect(tabForTarget("library")).toBe("library");
  expect(tabForTarget("shared")).toBe("shared");
  expect(tabForTarget("chords")).toBe("chords");
  for (const t of ["exercises", "recorder", "settings"] as const) expect(tabForTarget(t)).toBe("more");
  expect(tabForTarget(null)).toBeNull();
});
it("hides on full-height screens only", () => {
  for (const k of ["song", "sample", "editor"]) expect(hidesTabBar(k)).toBe(true);
  for (const k of ["home", "library", "shared", "chords", "settings", "new-song"]) expect(hidesTabBar(k)).toBe(false);
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/shell/TabBar.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** TabBar, the Rail exports and the App wiring.
- [ ] **Step 4: Run** the tests, `npx tsc -b` and `npx vitest run`. Expected: PASS.

### Task 4: Pocket tools in compact

**Files:**
- Modify: `src/ui/shell/Pocket.tsx`, `src/ui/shell/Pocket.module.css`
- Test: `src/ui/shell/pocketChip.test.ts` (with a new pure helper in `src/ui/shell/pocketChip.ts`)

**Interfaces:**
- Consumes: `BottomSheet`, `useCompact`, `hidesTabBar` (Tasks 1–3)
- Produces: `export function pocketChipText(s: { metronomeBpm: number | null; recordingSec: number | null }): string | null`
  - A recording wins: `"● m:ss"`.
  - Otherwise, with a metronome running: `"♩ <bpm>"` (whole bpm).
  - Otherwise `null`.
- In compact the floating pocket is replaced by one round **Tools** button (`aria-label="Tools"`, 56 px).
  - Its position is `bottom: calc(var(--tabbar-h) + 16px + env(safe-area-inset-bottom))` and `right: 16px`.
  - Where the tab bar is hidden, it sits 16 px above that screen's transport, using the CSS variable `--bottom-bar-h` that the practice and editor screens already know or get set to their bar height.
- Tapping the button opens a BottomSheet titled "Tools" with the same Tuner, BPM and Record controls and the same state. Move the existing JSX into a shared fragment so both layouts render one source.
- While the chip text isn't null, it shows as a pill attached to the button. Tapping the pill opens the sheet.
- `hide` and `inPractice` keep their current meaning.

- [ ] **Step 1: Write the failing tests**

```ts
expect(pocketChipText({ metronomeBpm: null, recordingSec: null })).toBeNull();
expect(pocketChipText({ metronomeBpm: 100, recordingSec: null })).toBe("♩ 100");
expect(pocketChipText({ metronomeBpm: 99.6, recordingSec: null })).toBe("♩ 100");
expect(pocketChipText({ metronomeBpm: 100, recordingSec: 12.4 })).toBe("● 0:12");
expect(pocketChipText({ metronomeBpm: null, recordingSec: 75 })).toBe("● 1:15");
```

- [ ] **Step 2: Run** `npx vitest run src/ui/shell/pocketChip.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the helper and the compact branch of Pocket.
- [ ] **Step 4: Run** the tests, `npx tsc -b` and `npx vitest run`. Expected: PASS.

### Task 5: Touch basics, safe areas and installability

**Files:**
- Modify: `index.html` (viewport meta, manifest link, theme-color, apple-touch-icon), `src/ui/tokens.css`, `src/ui/styles.css`, `src/ui/components/kit.module.css`
- Create: `public/manifest.webmanifest`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/icon-maskable-512.png`, `public/icons/apple-touch-icon.png` (180 px)
- Test: `src/ui/manifest.test.ts`

**Interfaces:** CSS only, plus static files.
- Viewport: `width=device-width, initial-scale=1.0, viewport-fit=cover`.
- Under `COMPACT_QUERY` in CSS:
  - `--gutter: 16px` drives the page side padding;
  - buttons, `[role=button]`, links styled as buttons, and the kit's controls get `min-height: 44px` and `min-width: 44px`;
  - `input` and `select` get `font-size: max(16px, 1em)`;
  - `.screen` side padding is `var(--gutter)`;
  - `html, body` get `overflow-x: hidden` only as a safety net (the smoke still checks for real overflow).
- Manifest:
  - `{ "name": "Taalmel", "short_name": "Taalmel", "start_url": "/", "display": "standalone" }`;
  - `background_color` and `theme_color` are the dark `--surface-1` value from `tokens.css`;
  - icons are listed with sizes and `"purpose": "maskable"` on the maskable one.
- Icons are rendered from `public/favicon.svg` with headless Chrome (muted, screenshot of the SVG at each size; the maskable icon has the logo at 80 % on the `--accent` background). They're generated once and checked in as PNGs.
- `index.html` gets `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color" content="…">` and `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`.

- [ ] **Step 1: Write the failing test** (reads the files with `fs`):

```ts
const m = JSON.parse(readFileSync("public/manifest.webmanifest", "utf8"));
expect(m).toMatchObject({ name: "Taalmel", start_url: "/", display: "standalone" });
for (const i of m.icons) expect(existsSync(`public${i.src}`)).toBe(true);
expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
const html = readFileSync("index.html", "utf8");
expect(html).toContain("viewport-fit=cover");
expect(html).toContain('rel="manifest"');
expect(html).not.toMatch(/serviceWorker/);
```

- [ ] **Step 2: Run** `npx vitest run src/ui/manifest.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the files and CSS.
- [ ] **Step 4: Run** the test, `npx vitest run` and `npx vite build`. Expected: PASS, and `dist/manifest.webmanifest` exists.

### Task 6: Home, Songs and Library list layouts in compact

**Files:**
- Modify: `src/ui/screens/Home.module.css` (the existing 900 and 560 px rules move under `COMPACT_QUERY`, phone rules under `PHONE_QUERY`), `src/ui/screens/Library.tsx`, `src/ui/screens/Library.module.css`, `src/ui/sharing/SharedScreen.tsx`, `src/ui/sharing/OpenLibrary.tsx`, `src/ui/sharing/RequestsTab.tsx`, `src/ui/sharing/sharing.module.css`, `src/ui/components/PageHead.module.css`, `src/ui/components/page.module.css`

**Interfaces:**
- Consumes: `useCompact` (only for the floating + button, which is markup that doesn't exist on laptop), `Popover` → sheet (Task 2), `Dialog` (Task 2)
- **Home** (§6.1): one column. The continue card is first. The toolbox grid is 2 across on phones and tablets: `repeat(2, minmax(0,1fr))`, which replaces today's single column at 560 px.
- **Songs** (§6.2):
  - `lib.grid` becomes a one-column list.
  - `lib.card` becomes a row with padding 12 px 16 px, the title on one line with an ellipsis, the meta line `BPM · time · capo · bars` and the density strip at full row width.
  - The `⋯` Popover already becomes a sheet (Task 2).
  - `lib.toolbar` is `position: sticky; top: 0`, with a `--surface-0` background and z-index above the rows.
  - The header's "Add a song" button is hidden, and a floating **+** button (56 px, `aria-label="Add a song"`) sits at `left: 16px` above the tab bar.
  - Example songs keep their own section, and each row keeps "Add to my library".
- **Library** (§6.3):
  - The existing Open library and Requests segmented control stays, full width and sticky like the Songs toolbar.
  - Open library rows follow the Songs row style.
  - The request form and song preview already open in `Dialog`, which is full-screen on phones from Task 2.
- **Tablets in landscape** (§6.4): when the content width is at least 700 px in compact, Songs and Library rows use `repeat(2, minmax(0,1fr))`, through a container query on the list's parent (`container-type: inline-size`).
- **Page titles**: `PageHead` title is 28 px in compact.

- [ ] **Step 1: Implement** the CSS and markup above. There's no new pure logic, so this task's tests are the Task 7 smoke checks.
- [ ] **Step 2: Run** `npx tsc -b` and `npx vitest run`. Expected: PASS.

### Task 7: Visual smoke across sizes

**Files:**
- Create: `scripts/smoke-mobile.mjs`. It's run with the scratchpad's `puppeteer-core` (`node <scratch>/node_modules/... scripts/smoke-mobile.mjs`, or copy it to the scratchpad), so it adds no repo dependency.

**Interfaces:**
- Consumes everything above. It launches Chrome with `--mute-audio` against `http://localhost:5199`, and Vite is started with `--port 5199 --strictPort`. Chrome and Vite are both stopped at the end.

- [ ] **Step 1: Write the script.** It covers:
  - sizes `[390×844, 768×1024, 1440×1000]` and a touch run `1024×768` with `page.emulateMediaFeatures([{name:"pointer",value:"coarse"},{name:"hover",value:"none"}])`;
  - themes dark and light;
  - screens Home, Songs (with a seeded song titled with 120 characters), Library, the More sheet and the Tools sheet.

  For each one, assert and print PASS or FAIL:
  - `document.documentElement.scrollWidth <= innerWidth`;
  - in compact, every visible `button, a, [role=button], input, select` has a bounding box of at least 44 × 44 (or sits inside a ≥ 44 px clickable parent);
  - the last list item's bottom is at or above the tab bar's top after scrolling to the end;
  - at 390 × 500, the focused search input lies inside the viewport;
  - in compact, every visible icon-only button has an `aria-label` (spec §4: no hover-only information).

  It also starts the metronome from the Tools sheet, closes the sheet, and checks that the chip shows "♩ 100".

  It saves screenshots to the scratchpad. The touch run must show the TabBar, not the Rail.
- [ ] **Step 2: Laptop identity check.** Compare new 1440 screenshots with the Task 1 Step 0 baseline by pixel diff. Expected: no differences outside dynamic text (the time-of-day line). Any layout difference is a FAIL.
- [ ] **Step 3: Run it.** Expected: every check PASSes. Look at the phone and tablet screenshots in both themes.
- [ ] **Step 4: Final checks.** `npx vitest run`, `npx tsc -b` and `npx vite build` all pass. Report to the owner with the screenshots. Don't commit or push.
