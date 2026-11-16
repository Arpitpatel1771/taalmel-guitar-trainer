// Mobile stage 3 smoke: Recorder (clips, trimmer), Chords (library, practice modes), Exercises.
// Needs `puppeteer-core` resolvable from where it runs and a Vite dev server on PORT (default 5202).
//   MODE=baseline OUT=<dir> node smoke-mobile-stage3.mjs  → 1440 screenshots (dark + light)
//   MODE=full OUT=<dir> node smoke-mobile-stage3.mjs      → all sizes, checks printed as PASS/FAIL
// Chrome runs muted with fake media devices and is closed at the end.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "5202";
const URL = `http://localhost:${PORT}/`;
const MODE = process.env.MODE || "full";
const OUT = process.env.OUT || "./mobile-shots";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// ONLY=recorder|chords|exercises limits a run to one screen (default: all).
const ONLY = process.env.ONLY || "";
const want = (n) => !ONLY || ONLY.includes(n);
const LONG_NAME = "Practice take of the verse with a really long clip name 2026-11-08";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function clickText(page, text, root = "body") {
  // Poll briefly: media devices and route changes take a moment to render their buttons.
  for (let i = 0; i < 20; i++) {
    const ok = await page.evaluate((text, root) => {
      const el = [...document.querySelector(root).querySelectorAll("button, a, [role=button], [role=tab], [role=radio]")].find(
        (b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(text) && !b.disabled && b.getClientRects().length,
      );
      el?.click();
      return !!el;
    }, text, root);
    if (ok) return void (await sleep(350));
    await sleep(250);
  }
  throw new Error(`no clickable "${text}"`);
}

async function open(page, target, compact) {
  if (compact && ["Exercises", "Recordings"].includes(target)) {
    await clickText(page, "More", "nav[aria-label='Tabs']");
    await clickText(page, target, "[role=dialog]");
  } else {
    await page.evaluate((target) => {
      const b = [...document.querySelectorAll("nav button, nav a")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith(target) && x.getClientRects().length);
      if (!b) throw new Error(`no nav item ${target}`);
      b.click();
    }, target);
  }
  await sleep(500);
}

async function newPage(browser, w, h, theme, touch) {
  // A fresh browser context per page keeps each run's recordings (IndexedDB) separate.
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: w, height: h, hasTouch: !!touch, isMobile: false });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle0" });
  return { page, errors };
}

async function recordClip(page, opts) {
  // Fake devices occasionally refuse the first start; retry a few times.
  for (let i = 0; ; i++) {
    try {
      return await recordClipOnce(page, opts);
    } catch (e) {
      if (i >= 2) throw e;
      await page.reload({ waitUntil: "networkidle0" });
      await open(page, "Recordings", await page.evaluate(() => !!document.querySelector("nav[aria-label='Tabs']")));
    }
  }
}

async function recordClipOnce(page, { video, ms = 2500 }) {
  // Switch input, enable device, record, stop.
  await clickText(page, video ? "Video + audio" : "Audio only", ".screen");
  const off = await page.evaluate(() => [...document.querySelectorAll("button")].some((b) => /^Turn off/.test(b.textContent.trim())));
  if (off) await clickText(page, "Turn off", ".screen");
  await clickText(page, "Enable", ".screen");
  await sleep(800);
  await clickText(page, "Record", ".screen");
  await sleep(ms);
  await clickText(page, "Stop", ".screen");
  await sleep(1200);
}

async function seedClips(page) {
  await recordClip(page, { video: false });
  await recordClip(page, { video: true });
  await recordClip(page, { video: false, ms: 1500 });
  // Long name on the first clip.
  const input = (await page.$$("input[aria-label='Clip name']"))[0];
  await input.click({ clickCount: 3 });
  await input.type(LONG_NAME);
  await page.keyboard.press("Enter");
  await sleep(500);
  // Turn the device off to see the idle recorder.
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Turn off/.test(b.textContent.trim()))?.click());
  await sleep(300);
}

const layoutChecks = (label) => async (page) => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const small = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (el.closest("nav[aria-label='Tabs']")) continue;
      if (el.matches("input[type=checkbox], input[type=radio], input[type=range]")) continue;
      const box = el.closest("label, button, a") ?? el;
      const b = box.getBoundingClientRect();
      if (b.width < 43.5 || b.height < 43.5) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`);
    }
    const screen = document.querySelector(".screen");
    return { overflow: document.documentElement.scrollWidth - vw, inner: screen ? screen.scrollWidth - screen.clientWidth : 0, small };
  });
  check(`${label}: no horizontal scroll`, r.overflow <= 0 && r.inner <= 0, `page ${r.overflow}px, screen ${r.inner}px`);
  check(`${label}: tap targets >= 44px`, r.small.length === 0, r.small.slice(0, 6).join("; "));
};

async function clipRowChecks(page, label) {
  const r = await page.evaluate((long) => {
    const rows = [...document.querySelectorAll("li")].filter((li) => li.querySelector("input[aria-label='Clip name']"));
    return rows.map((li) => {
      const inp = li.querySelector("input[aria-label='Clip name']");
      const meta = li.querySelector("span");
      const lr = li.getBoundingClientRect();
      const btns = [...li.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
      return {
        // Name input shows the full text when its content fits (scrollWidth <= clientWidth).
        nameFits: inp.scrollWidth <= inp.clientWidth + 1,
        nameW: Math.round(inp.clientWidth),
        metaFits: meta ? meta.scrollWidth <= meta.clientWidth + 1 : true,
        btnsInside: btns.every((b) => b.right <= lr.right + 0.5 && b.left >= lr.left - 0.5),
        rowH: Math.round(lr.height),
      };
    });
  }, LONG_NAME);
  check(`${label}: ${r.length} clip rows`, r.length >= 3, String(r.length));
  check(`${label}: clip buttons inside rows`, r.every((x) => x.btnsInside));
  check(`${label}: clip meta not clipped`, r.every((x) => x.metaFits));
  console.log(`   name widths ${r.map((x) => `${x.nameW}${x.nameFits ? "" : "(clipped)"}`).join(", ")}; row heights ${r.map((x) => x.rowH).join(", ")}`);
  return r;
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--mute-audio", "--no-first-run", "--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});
const SCREENS = [["recorder", "Recordings"], ["chords", "Chords"], ["exercises", "Exercises"]];
try {
  const sizes = MODE === "baseline"
    ? [{ w: 1440, h: 1000, compact: false }]
    : [
        { w: 390, h: 844, compact: true },
        { w: 768, h: 1024, compact: true },
        { w: 1024, h: 768, compact: true, touch: true },
        { w: 1440, h: 1000, compact: false },
      ];
  for (const s of sizes) {
    for (const theme of ["dark", "light"]) {
      const tag = `${s.w}${s.touch ? "-touch" : ""}-${theme}`;
      const { page, errors } = await newPage(browser, s.w, s.h, theme, s.touch);
      // Tall shot: the compact layout scrolls inside the page, so grow the viewport to see all of a screen.
      const shotTall = async (n) => {
        await page.setViewport({ width: s.w, height: 2600, hasTouch: !!s.touch, isMobile: false });
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, `${n}-${tag}.png`) });
        await page.setViewport({ width: s.w, height: s.h, hasTouch: !!s.touch, isMobile: false });
        await sleep(200);
      };
      const shot = (n) => page.screenshot({ path: path.join(OUT, `${n}-${tag}.png`) });
      const full = MODE !== "baseline";
      const checks = full && s.compact ? layoutChecks : () => async () => {};

      if (want("recorder")) {
      // Recorder
      await open(page, "Recordings", s.compact);
      await shot("recorder-empty");
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => /^Enable/.test(b.textContent.trim()))?.click());
      await sleep(800);
      await shot("recorder-ready");
      await checks(`${tag} recorder ready`)(page);
      await clickText(page, "Record", ".screen");
      await sleep(1200);
      await shot("recorder-recording");
      await checks(`${tag} recorder recording`)(page);
      if (full) {
        const flagBtn = await page.evaluate(() => !![...document.querySelectorAll("button")].find((b) => /^Flag/.test(b.textContent.trim()) && b.getClientRects().length));
        check(`${tag}: Flag button reachable while recording`, flagBtn);
        const kbd = await page.evaluate(() => !!document.querySelector("kbd") && getComputedStyle(document.querySelector("kbd")).display !== "none");
        if (s.compact) check(`${tag}: M key hint hidden on touch/compact`, !kbd);
      }
      await clickText(page, "Stop", ".screen");
      await sleep(1000);
      // Fresh page state for seeding: reload keeps IndexedDB clips; add the rest.
      await seedClips(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await shot("recorder-clips");
      await checks(`${tag} recorder clips`)(page);
      if (full) await clipRowChecks(page, `${tag} clips`);
      // Confirm-delete state.
      await page.evaluate(() => document.querySelector("button[aria-label='Delete']")?.click());
      await sleep(300);
      await shot("recorder-confirm");
      await checks(`${tag} recorder confirm-delete`)(page);
      await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Cancel")?.click());
      await sleep(200);
      // Trimmer on the audio clip (first row = long name)
      await page.evaluate(() => document.querySelector("button[aria-label='Play / trim']")?.click());
      await sleep(1500);
      await page.evaluate(() => document.querySelector("[class*=trimmer]")?.scrollIntoView());
      await sleep(300);
      await shot("recorder-trimmer");
      await checks(`${tag} trimmer`)(page);
      await page.evaluate(() => { document.querySelector("[class*=trimmer]")?.lastElementChild?.scrollIntoView({ block: "end" }); });
      await sleep(300);
      await shot("recorder-trimmer-bottom");
      await checks(`${tag} trimmer bottom`)(page);
      await page.evaluate(() => document.querySelector("[class*=trimmer]")?.scrollIntoView());
      await sleep(200);
      if (full) {
        const t = await page.evaluate(() => {
          const track = document.querySelector("[class*=rangeTrack]");
          if (!track) return null;
          const r = track.getBoundingClientRect();
          return { w: r.width, left: r.left, right: r.right, vw: innerWidth };
        });
        check(`${tag}: trim track fits viewport`, !!t && t.left >= 0 && t.right <= t.vw, JSON.stringify(t));
      }
      // Drag the left handle by touch/pointer.
      if (full) {
        await sleep(800); // smooth scroll settles
        const before = await page.evaluate(() => document.querySelectorAll("input[type=range]")[0]?.value);
        const box = await page.evaluate(() => {
          const r = document.querySelector("[class*=rangeTrack]").getBoundingClientRect();
          return { x: r.left + (innerWidth < 900 || matchMedia('(pointer: coarse)').matches ? 7 : 17), y: r.top + r.height / 2, w: r.width };
        });
        const cdp = await page.createCDPSession();
        const touch = async (type, x, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
        if (s.touch || s.w < 900) {
          await touch("touchStart", box.x, box.y);
          for (let i = 1; i <= 8; i++) await touch("touchMove", box.x + (box.w * 0.3 * i) / 8, box.y);
          await touch("touchEnd");
        } else {
          await page.mouse.move(box.x, box.y);
          await page.mouse.down();
          await page.mouse.move(box.x + box.w * 0.3, box.y, { steps: 8 });
          await page.mouse.up();
        }
        await sleep(300);
        const after = await page.evaluate(() => document.querySelectorAll("input[type=range]")[0]?.value);
        check(`${tag}: left trim handle dragged by ${s.compact ? "touch" : "mouse"}`, before !== after, `${before} -> ${after}`);
        await cdp.detach();
        await shot("recorder-trimmer-dragged");
      }

      }
      if (want("chords")) {
      // Chords screen
      await open(page, "Chords", s.compact);
      await sleep(500);
      await shot("chords");
      await checks(`${tag} chords`)(page);
      // The Library / My chords / Practice switch is a segmented control (buttons), not role=tab.
      await page.evaluate(() => document.querySelector("[class*=cardSelect]")?.click());
      await sleep(400);
      await shotTall("chords-selected");
      await checks(`${tag} chords selected`)(page);
      await clickText(page, "Practice", ".screen");
      for (const mode of ["Changes", "Quiz", "Progressions", "Mic check"]) {
        await clickText(page, mode, ".screen");
        await sleep(300);
        await shotTall(`practice-${mode.replace(" ", "").toLowerCase()}`);
        await checks(`${tag} practice ${mode}`)(page);
        const startBtn = () => page.evaluate(() => { const b = [...document.querySelectorAll(".screen button")].find((x) => /^Start/.test(x.textContent.trim())); b?.click(); return !!b; });
        if (mode === "Quiz" && (await startBtn())) {
          await sleep(500);
          await shotTall("practice-quiz-running");
          await checks(`${tag} quiz running`)(page);
          // Answer by tapping the first option, then the next step.
          await page.evaluate(() => document.querySelector("[class*=option]")?.click());
          await sleep(400);
          await shotTall("practice-quiz-answered");
          await checks(`${tag} quiz answered`)(page);
          await page.evaluate(() => [...document.querySelectorAll(".screen button")].find((x) => /^(Stop|End|Finish|Quit)/.test(x.textContent.trim()))?.click());
          await sleep(300);
        }
        if (mode === "Changes" && (await startBtn())) {
          await sleep(5000);
          await shotTall("practice-changes-running");
          await checks(`${tag} changes running`)(page);
          await page.evaluate(() => [...document.querySelectorAll(".screen button")].find((x) => /^(Stop|Cancel|End)/.test(x.textContent.trim()))?.click());
          await sleep(300);
        }
        if (mode === "Progressions" && (await startBtn())) {
          await sleep(1500);
          await shotTall("practice-progressions-running");
          await checks(`${tag} progressions running`)(page);
          await page.evaluate(() => [...document.querySelectorAll(".screen button")].find((x) => /^(Stop|Cancel|End)/.test(x.textContent.trim()))?.click());
          await sleep(300);
        }
      }
      }
      if (want("exercises")) {
      // Exercises
      await open(page, "Exercises", s.compact);
      await sleep(400);
      await shotTall("exercises");
      await checks(`${tag} exercises`)(page);
      const kinds = await page.evaluate(() => [...document.querySelectorAll("[class*=kind]")].filter((b) => b.tagName === "BUTTON").length);
      for (let i = 1; i < kinds; i++) {
        await page.evaluate((i) => [...document.querySelectorAll("[class*=kind]")].filter((b) => b.tagName === "BUTTON")[i]?.click(), i);
        await sleep(400);
        await shotTall(`exercises-${i}`);
        await checks(`${tag} exercises kind ${i}`)(page);
      }

      }
      if (full) check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
      await page.close();
    }
  }
  console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
