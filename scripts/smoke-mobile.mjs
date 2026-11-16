// Mobile layout smoke (plans/8-11-mobile-stage1-plan.md, Task 7). Needs `puppeteer-core` resolvable
// from where it runs (it is not a repo dependency) and a Vite dev server on PORT (default 5199).
//   MODE=baseline OUT=<dir> node smoke-mobile.mjs   → 1440 screenshots of Home, Songs, Library
//   MODE=full OUT=<dir> node smoke-mobile.mjs       → all sizes, checks printed as PASS/FAIL
// Chrome always runs muted and is closed at the end.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "5199";
const URL = `http://localhost:${PORT}/`;
const MODE = process.env.MODE || "full";
const OUT = process.env.OUT || "./mobile-shots";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LONG_TITLE = "A very long song title that keeps going and going to check that nothing overflows the screen ever ok";
const TAB = `${LONG_TITLE}
e|-3h5p3--5---|-0--3--0--3--|
B|-3----------|-1--0--1--0--|
G|------------|-0--0--0--0--|
D|------------|-2--0--2--0--|
A|------------|-3--2--3--2--|
E|------------|-------------|
`;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

async function clickText(page, text) {
  await page.evaluate((text) => {
    const el = [...document.querySelectorAll("button, a, [role=button], [role=tab], [role=radio]")].find(
      (b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(text) && !b.disabled && b.getClientRects().length,
    );
    if (!el) throw new Error(`no clickable "${text}"`);
    el.click();
  }, text);
  await sleep(350);
}

async function seedSong(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button, [role=button]")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith("Songs") && x.getClientRects().length);
    b?.click();
  });
  await sleep(400);
  await clickText(page, "Add a song");
  await page.type("textarea", TAB);
  await sleep(300);
  const title = MODE === "baseline" ? null : await page.$("input[type=text]");
  if (title) {
    await title.click({ clickCount: 3 });
    await title.type(LONG_TITLE);
  }
  await clickText(page, "Open in editor");
  await sleep(1200);
  await clickText(page, "Save song");
  await sleep(1200);
  // Saving opens the song (no tab bar there by design): start the checks from Home.
  await page.goto(URL, { waitUntil: "networkidle0" });
}

async function open(page, target) {
  // Rail or tab bar: both label their buttons.
  await page.evaluate((target) => {
    const b = [...document.querySelectorAll("nav button, nav a")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith(target) && x.getClientRects().length);
    if (!b) throw new Error(`no nav item ${target}`);
    b.click();
  }, target);
  await sleep(500);
}

async function newPage(browser, w, h, theme, touch) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, hasTouch: !!touch, isMobile: false });
  // Touch emulation (hasTouch) is what makes Chrome report (pointer: coarse) and (hover: none).
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle0" });
  return { page, errors };
}

const layoutChecks = (label) => async (page) => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const small = [];
    const unlabeled = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;
      if (rect.bottom < 0 || rect.top > window.innerHeight) continue;
      if (el.matches("input[type=checkbox], input[type=radio], input[type=range]")) continue;
      const box = el.closest("label, button, a") ?? el;
      const b = box.getBoundingClientRect();
      if (b.width < 44 - 0.5 || b.height < 44 - 0.5) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(b.width)}×${Math.round(b.height)}`);
      if (el.tagName === "BUTTON" && !(el.textContent || "").trim() && !el.getAttribute("aria-label")) unlabeled.push(el.outerHTML.slice(0, 60));
    }
    return { overflow: document.documentElement.scrollWidth - vw, small, unlabeled };
  });
  check(`${label}: no horizontal scroll`, r.overflow <= 0, `overflow ${r.overflow}px`);
  check(`${label}: tap targets ≥ 44px`, r.small.length === 0, r.small.slice(0, 6).join("; "));
  check(`${label}: icon buttons labelled`, r.unlabeled.length === 0, r.unlabeled.slice(0, 3).join("; "));
};

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--mute-audio", "--no-first-run", "--autoplay-policy=no-user-gesture-required"] });
try {
  if (MODE === "baseline") {
    for (const theme of ["dark", "light"]) {
      const { page } = await newPage(browser, 1440, 1000, theme);
      await seedSong(page);
      for (const [name, target] of [["home", "Home"], ["songs", "Songs"], ["library", "Library"]]) {
        await open(page, target);
        await page.screenshot({ path: path.join(OUT, `${name}-1440-${theme}.png`) });
      }
      await page.close();
    }
    console.log(`baseline saved to ${OUT}`);
  } else {
    const sizes = [
      { w: 390, h: 844, compact: true },
      { w: 768, h: 1024, compact: true },
      { w: 1024, h: 768, compact: true, touch: true },
      { w: 1440, h: 1000, compact: false },
    ];
    for (const s of sizes) {
      for (const theme of ["dark", "light"]) {
        const tag = `${s.w}${s.touch ? "-touch" : ""}-${theme}`;
        const { page, errors } = await newPage(browser, s.w, s.h, theme, s.touch);
        await seedSong(page);
        if (s.touch) check(`${tag}: touch emulation reports a coarse pointer`, await page.evaluate(() => matchMedia("(hover: none) and (pointer: coarse)").matches));
        const hasTabBar = await page.evaluate(() => !!document.querySelector("nav[aria-label='Tabs']"));
        check(`${tag}: ${s.compact ? "tab bar" : "rail"} shown`, hasTabBar === s.compact);
        for (const [name, target] of [["home", "Home"], ["songs", "Songs"], ["library", "Library"]]) {
          await open(page, target);
          await page.screenshot({ path: path.join(OUT, `${name}-${tag}.png`) });
          if (s.compact) {
            await layoutChecks(`${tag} ${name}`)(page);
            const covered = await page.evaluate(async () => {
              const bar = document.querySelector("nav[aria-label='Tabs']");
              const items = document.querySelectorAll("main li");
              if (!bar || !items.length) return null;
              const scroller = [...document.querySelectorAll("main, main *")].find((e) => e.scrollHeight > e.clientHeight + 4 && getComputedStyle(e).overflowY !== "visible") ?? document.scrollingElement;
              scroller.scrollTop = scroller.scrollHeight;
              await new Promise((r) => setTimeout(r, 200));
              return items[items.length - 1].getBoundingClientRect().bottom - bar.getBoundingClientRect().top;
            });
            if (covered !== null) check(`${tag} ${name}: last item clear of tab bar`, covered <= 0.5, `${Math.round(covered)}px under`);
          }
        }
        if (s.compact) {
          await clickText(page, "More");
          await page.screenshot({ path: path.join(OUT, `more-${tag}.png`) });
          check(`${tag}: More sheet lists Exercises/Recordings/Settings`, await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); return !!d && ["Exercises", "Recordings", "Settings"].every((t) => d.textContent.includes(t)); }));
          await page.keyboard.press("Escape");
          await sleep(300);
          check(`${tag}: Esc closes the sheet`, await page.evaluate(() => !document.querySelector("[role=dialog]")));
          await clickText(page, "Tools");
          await page.screenshot({ path: path.join(OUT, `tools-${tag}.png`) });
          await page.evaluate(() => {
            const d = document.querySelector("[role=dialog]");
            const b = d && [...d.querySelectorAll("button")].find((x) => (x.textContent || "").trim() === "Start");
            b?.click();
          });
          await sleep(400);
          await page.keyboard.press("Escape");
          await sleep(300);
          const chip = await page.evaluate(() => document.body.innerText.match(/♩ \d+/)?.[0] ?? null);
          check(`${tag}: metronome chip visible after closing Tools`, !!chip, chip ?? "none");
          await page.evaluate(() => {
            const d = document.querySelector("[aria-label='Tools']");
            d?.click();
          });
          await sleep(300);
          await page.keyboard.press("Escape");
        }
        check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
        await page.close();
      }
    }
    // Phone keyboard: a short viewport with the search focused keeps it visible.
    {
      const { page } = await newPage(browser, 390, 500, "dark");
      await seedSong(page);
      await open(page, "Songs");
      const vis = await page.evaluate(() => {
        const i = document.querySelector("input[type=search], input[placeholder*='Search' i]");
        if (!i) return null;
        i.focus();
        i.scrollIntoView({ block: "nearest" });
        const r = i.getBoundingClientRect();
        return r.top >= 0 && r.bottom <= window.innerHeight;
      });
      check("390x500: focused search visible", vis === true, String(vis));
      await page.close();
    }
    console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
