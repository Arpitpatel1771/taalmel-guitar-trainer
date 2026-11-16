# Taalmel: Mobile and tablet (design spec)

Status: draft for review, 2026-11-08.
Problem: the app is laptop-only. The owner will use it on a phone first, and once it is public, people will use it on any phone or tablet for anything it does.

One app whose layout adapts to the width. The laptop layout stays exactly as it is; a **compact** layout is added screen by screen, in four stages. This spec covers all four stages in outline and stage 1 in full.

---

## 1. Principles

- **One codebase, one set of screens.** Screens and logic are shared; CSS breakpoints change the layout. A small `useCompact()` hook is used only where the structure itself changes (for example, the rail becoming a bottom tab bar). There are no separate mobile components per screen.
- **Compact** means viewport width < 900 px **or** a touch-first device (`(hover: none) and (pointer: coarse)`). Phones and tablets both get the compact layout. Laptops (≥ 900 px with a fine pointer) keep today's layout.
- **Any modern browser on any phone.** No device- or vendor-specific branches. Where a browser lacks a capability, the feature hides itself based on whether the capability exists, whatever the device. For example, pitch hints need tab-audio capture (`getDisplayMedia` with audio), which phone browsers don't offer.
- **Touch is a full input, not a fallback.** Every hover-only affordance gets a tap or long-press equivalent, and every right-click gets a long-press.

## 2. Stages

Each stage is built and shipped on its own, in this order.

1. **Foundations:** the compact shell, navigation, pocket tools, touch basics, installability, and the Home, Songs and Library screens. Detailed in §3–§6.
2. **Practice:** the song sheet, transport, loop, tuner and metronome. The phone, held or on a stand, gets the most use here. Needs its own spec.
3. **Recorder and chord tools:** the Recorder screen, clip trimmer, chord diagrams, quiz, one-minute changes and progressions. Needs its own spec.
4. **Add a song and the piano-roll editor:** touch editing (drag notes with a finger, long-press for what right-click does today, pinch to zoom, two-finger scroll). Pitch hints are unavailable on phones (§1). Needs its own spec.

Until a screen's stage ships, it keeps working in the compact shell with its laptop layout, scaled down and scrollable. It doesn't have to be pretty, but it must not be broken.

## 3. Compact shell and navigation (stage 1)

### 3.1 Bottom tab bar

- The side rail (`src/ui/shell/Rail.tsx`) becomes a **bottom tab bar** in compact, with five slots: **Home · Songs · Library · Chords · More**. Each slot is an icon above a short label, like the rail today.
- **More** opens a bottom sheet with Exercises, Recordings, Settings, the theme switch (the same tap and hold behaviour as the rail) and the Google account chip.
- The active tab is highlighted the same way the rail highlights it. When the current screen lives under More (Exercises, Recordings, Settings), the More tab is highlighted.
- **Full-height screens hide the tab bar**: the practice screen (song view) and the song editor. Their header gets a back arrow that returns to where you came from.
- The bar sits above the bottom safe area (`env(safe-area-inset-bottom)`).

### 3.2 Pocket tools

- On a laptop, the pocket (Tuner, BPM, Record; `src/ui/shell/Pocket.tsx`) floats in the bottom-right corner. In compact it becomes one round **Tools** button floating above the tab bar on the right.
- Tapping it opens a bottom sheet with the same three tools and the same behaviour (tuner, free metronome, quick record).
- **Live chip:** while the metronome runs or a quick recording is going, the button shows a small chip ("♩ 100" or "● 0:12") so it's clear something is running with the sheet closed. Tapping the chip opens the sheet.
- On full-height screens (§3.1) the Tools button sits above that screen's own bottom bar (for example the transport) and never covers it.

### 3.3 Sheets and dialogs

- In compact, popovers (for example the transport's More controls) and menus open as **bottom sheets**: drag handle, swipe down or tap outside to close, focus trapped while open, Esc closes.
- Dialogs open **full-screen on phones** (width < 600 px) and as **centred sheets on tablets**.

## 4. Touch basics (stage 1, applies everywhere)

- **Tap targets** are at least 44 × 44 px in compact, using padding where the visible control is smaller.
- **No hover-only information.** Tooltips (`title`) are not the only place a control's meaning lives; icon-only buttons keep an `aria-label`, and anything explained only on hover gets a visible label or a long-press hint in compact.
- **No horizontal page scroll.** Side gutters are 16 px. Content that is genuinely wide (the sheet, the roll) scrolls inside its own container.
- **Safe areas:** fixed bars and floating buttons pad for `env(safe-area-inset-*)`. The viewport meta gets `viewport-fit=cover`.
- **Text inputs** use at least 16 px text in compact, so phone browsers don't zoom the page when an input is focused.
- **Gestures:** no custom gestures in stage 1 beyond sheet swipe-to-close.

## 5. Installable (stage 1)

- Add a web app manifest (name "Taalmel", short name, theme and background colours from the design tokens, `display: standalone`, start URL `/`) and icons (192, 512, maskable, and an Apple touch icon).
- "Add to Home screen" then opens Taalmel full-screen like an app.
- **No service worker and no offline caching** in this stage. Caching brings back stale-version problems (an old version keeps running after a deploy), which recently caused a confusing Drive bug. Offline support is a later item.

## 6. List screens in compact (stage 1)

### 6.1 Home

- One column: the **continue** card at the top (its bar preview scales to the width), then the tool shortcuts as a **2-across grid of tiles**, then the remaining sections stacked.

### 6.2 Songs

- The card grid becomes a **one-column list of compact rows**. Each row shows the title, a meta line `BPM · time · capo · bars` and the density strip.
- Tapping a row opens the song, and the row's `⋯` opens a bottom sheet with the actions the card menu has today (Edit, Share, Delete…).
- Search and sort sit in a **sticky bar** at the top of the list.
- **Add a song** becomes a floating **+** button above the tab bar, on the left so it doesn't collide with the Tools button.
- **Example songs** stay as their own section below the user's songs, with "Add to my library" in each row.

### 6.3 Library (shared songs and requests)

- Browse and Requests become **two tabs** at the top of the screen.
- Song rows behave like the Songs list (§6.2).
- The request form and song previews open **full-screen** with a back arrow.

### 6.4 Shared rules

- Page titles shrink to a compact header (the existing `PageHead` 900 px rule grows into this).
- Tablets in landscape use **2 columns** where the content is a list of cards or rows and there is room (≥ 700 px of content width).

## 7. Tests (stage 1)

- **Unit:** `useCompact()` (the width and pointer rules, and updating on resize or orientation change); the tab bar's active slot for every screen, including the More screens.
- **Visual smoke** (headless Chrome, muted, stopped after each run): Home, Songs, Library, the More sheet and the Tools sheet at **390 px** (phone), **768 px** (small tablet) and **1440 px** (laptop), in dark and light. Each run checks that:
  - there is no horizontal page scroll (`scrollWidth <= innerWidth`);
  - every visible button or link in compact is at least 44 × 44 px (counting its padding);
  - fixed bars don't cover the last list item (bottom padding equals the bar height);
  - the 1440 px screenshots match today's laptop layout.
- **Touch emulation:** the same runs with a coarse-pointer emulation at 1024 px confirm a touch tablet in landscape gets the compact layout.

## 8. Out of scope (for now)

- Offline support and a service worker (§5).
- Native apps or app-store builds.
- Stages 2–4 details: each gets its own spec when its turn comes.
- Phone-specific features (vibration, share sheet integration) beyond what the web already gives.
