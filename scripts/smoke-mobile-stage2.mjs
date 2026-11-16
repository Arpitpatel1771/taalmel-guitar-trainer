// Mobile stage 2 (Practice) smoke: practice screen, Tuner and Metronome. Needs `puppeteer-core` resolvable
// from where it runs (it is not a repo dependency) and a Vite dev server on PORT (default 5201).
//   MODE=baseline OUT=<dir> node smoke-mobile-stage2.mjs   -> 1440 screenshots (dark + light) for pixel diffs
//   MODE=full OUT=<dir> node smoke-mobile-stage2.mjs       -> 390/768/1024 touch + landscape checks, PASS/FAIL
// Chrome always runs muted and is closed at the end.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { readFileSync } from "node:fs";

const PORT = process.env.PORT || "5201";
const URL = `http://localhost:${PORT}/`;
const MODE = process.env.MODE || "full";
const OUT = process.env.OUT || "./mobile-stage2-shots";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TITLE = "A very long song title that keeps going and going to check the practice header wraps";
const BARS = "|-3h5p3--5---|-0--3--0--3--|-3h5p3--5---|-0--3--0--3--|-3h5p3--5---|-0--3--0--3--|";
const TAB = `${TITLE}
e${BARS.replace(/-3h5p3--5---/g, "-3h5p3--5---")}
B|-3----------|-1--0--1--0--|-3----------|-1--0--1--0--|-3----------|-1--0--1--0--|
G|------------|-0--0--0--0--|------------|-0--0--0--0--|------------|-0--0--0--0--|
D|------------|-2--0--2--0--|------------|-2--0--2--0--|------------|-2--0--2--0--|
A|------------|-3--2--3--2--|------------|-3--2--3--2--|------------|-3--2--3--2--|
E|------------|-------------|------------|-------------|------------|-------------|
`;

const DENSE = `Dense run
e|-12-10-8--10-12-15-12-10-12-10-8--7--8--10-12-13-12-10-8--10-12-15-12-10-12-10-8--7--8--10-12-13-|
B|-------------------------------------------------------------------------------------------------|
G|-------------------------------------------------------------------------------------------------|
D|-------------------------------------------------------------------------------------------------|
A|-------------------------------------------------------------------------------------------------|
E|-------------------------------------------------------------------------------------------------|
`;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` - ${detail}` : ""}`);
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

async function nav(page, target) {
  await page.evaluate((target) => {
    const b = [...document.querySelectorAll("nav button, nav a")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith(target) && x.getClientRects().length);
    if (!b) throw new Error(`no nav item ${target}`);
    b.click();
  }, target);
  await sleep(500);
}

async function seedSong(page, tab = TAB, name = TITLE) {
  await nav(page, "Songs");
  await clickText(page, "Add a song");
  await page.type("textarea", tab);
  await sleep(300);
  const title = await page.$("input[type=text]");
  if (title) {
    await title.click({ clickCount: 3 });
    await title.type(name);
  }
  await clickText(page, "Open in editor");
  await sleep(1200);
  await clickText(page, "Save song");
  await sleep(1500); // saving opens the song in practice
}

async function newPage(browser, w, h, theme, touch) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, hasTouch: !!touch, isMobile: false });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle0" });
  return { page, errors };
}

const layoutChecks = (label) => async (page) => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const small = [];
    const unlabeled = [];
    for (const el of document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (getComputedStyle(el).visibility === "hidden") continue;
      if (rect.bottom < 0 || rect.top > vh || rect.right < 0 || rect.left > vw) continue;
      if (el.matches("input[type=checkbox], input[type=radio], input[type=range]")) continue;
      const box = el.closest("label, button, a") ?? el;
      const b = box.getBoundingClientRect();
      const name = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(b.width)}x${Math.round(b.height)}`;
      if (b.width < 43.5 || b.height < 43.5) small.push(name);
      if (el.tagName === "BUTTON" && !(el.textContent || "").trim() && !el.getAttribute("aria-label")) unlabeled.push(el.outerHTML.slice(0, 60));
    }
    const scrollers = [...document.querySelectorAll(".screen, main")].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => `${e.className} ${e.scrollWidth}>${e.clientWidth}`);
    const offscreen = [...document.querySelectorAll("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width && (r.right > vw + 1 || r.left < -1) && !b.closest(".sheet-scroll, [role=radiogroup]");
    }).map((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().slice(0, 20));
    return { overflow: document.documentElement.scrollWidth - vw, small, unlabeled, scrollers, offscreen };
  });
  check(`${label}: no horizontal page scroll`, r.overflow <= 0, `overflow ${r.overflow}px`);
  check(`${label}: no horizontal scroll in .screen`, r.scrollers.length === 0, r.scrollers.join("; "));
  check(`${label}: tap targets >= 44px`, r.small.length === 0, r.small.slice(0, 8).join("; "));
  check(`${label}: icon buttons labelled`, r.unlabeled.length === 0, r.unlabeled.slice(0, 3).join("; "));
  check(`${label}: nothing off-screen`, r.offscreen.length === 0, r.offscreen.join(", "));
};

const rectOf = (page, sel) => page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height }; }, sel);

async function openSong(page) {
  await nav(page, "Songs").catch(() => {});
  await clickText(page, "A very long song title");
  await sleep(1200);
}

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--mute-audio", "--no-first-run", "--autoplay-policy=no-user-gesture-required"] });
try {
  if (MODE === "baseline") {
    for (const theme of ["dark", "light"]) {
      const { page } = await newPage(browser, 1440, 1000, theme);
      await seedSong(page);
      await page.screenshot({ path: path.join(OUT, `practice-1440-${theme}.png`) });
      await page.goto(URL, { waitUntil: "networkidle0" });
      for (const name of ["Tuner", "Metronome"]) {
        await clickText(page, name);
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, `${name.toLowerCase()}-1440-${theme}.png`) });
        await page.goto(URL, { waitUntil: "networkidle0" });
      }
      await page.close();
    }
    console.log(`baseline saved to ${OUT}`);
  } else {
    const sizes = [
      { w: 390, h: 844, touch: true },
      { w: 844, h: 390, touch: true, tag: "landscape" },
      { w: 768, h: 1024, touch: true },
      { w: 1024, h: 768, touch: true },
    ];
    for (const s of sizes) {
      for (const theme of ["dark", "light"]) {
        const tag = `${s.w}x${s.h}-${theme}`;
        const { page, errors } = await newPage(browser, s.w, s.h, theme, s.touch);
        await seedSong(page);
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, `practice-${tag}.png`) });
        await layoutChecks(`${tag} practice`)(page);

        // Header: the full title is readable (not cut to a few letters).
        const title = await page.evaluate(() => { const h = document.querySelector("h2"); return h ? { w: h.getBoundingClientRect().width, text: h.textContent, clipped: h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1 } : null; });
        check(`${tag}: title wide enough`, !!title && title.w >= Math.min(200, s.w * 0.45), `w=${Math.round(title?.w ?? 0)}`);

        // Transport sits at the bottom, one row, clear of the Tools button.
        const bar = await rectOf(page, "[data-transport]");
        check(`${tag}: transport bar found`, !!bar);
        if (bar) {
          check(`${tag}: transport at the bottom edge`, s.h - bar.bottom < 40, `gap ${Math.round(s.h - bar.bottom)}px, height ${Math.round(bar.height)}px`);
          const tools = await rectOf(page, "[aria-label='Tools']");
          if (tools) check(`${tag}: Tools button clear of transport`, tools.bottom <= bar.top + 0.5, `tools bottom ${Math.round(tools.bottom)} vs bar top ${Math.round(bar.top)}`);
          console.log(`INFO ${tag}: transport top=${Math.round(bar.top)} height=${Math.round(bar.height)} -> Tools offset from viewport bottom should be >= ${Math.round(s.h - bar.top)}px`);
        }
        // Sheet is visible and not under the transport.
        const sheet = await rectOf(page, ".sheet-scroll");
        check(`${tag}: sheet has room`, !!sheet && sheet.height >= 120, `h=${Math.round(sheet?.height ?? 0)}`);

        // Touch: tap a bar header sets a single-bar loop.
        const barBox = await page.evaluate(() => {
          const top = document.querySelector(".sheet-scroll").getBoundingClientRect();
          const e = [...document.querySelectorAll(".bar-labels")].filter((x) => { const r = x.getBoundingClientRect(); return r.top > top.top - 6 && r.top < top.bottom - 24; })[0];
          if (!e) return null;
          const r = e.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + 10, bar: e.dataset.bar };
        });
        check(`${tag}: a bar header is visible to tap`, !!barBox);
        if (barBox) {
          await page.touchscreen.tap(barBox.x, barBox.y);
          await sleep(400);
          const loopTxt = await page.evaluate(() => [...document.querySelectorAll("[data-transport] button")].map((b) => b.getAttribute("aria-label") || b.textContent).join("|"));
          check(`${tag}: tap on bar ${barBox.bar} sets the loop`, loopTxt.includes(`Loop bar ${barBox.bar}`), loopTxt.slice(0, 80));
          // Hold and drag over the next bars: the range grows (touch events, as a finger would send them).
          const range = await page.evaluate(async (bar) => {
            const el = document.querySelector(".sheet-scroll");
            const labels = [...el.querySelectorAll(".bar-labels")];
            const from = labels.find((l) => l.dataset.bar === String(bar));
            const to = labels[labels.indexOf(from) + 1];
            if (!to) return null;
            const pt = (n, x, y) => new Touch({ identifier: 1, target: n, clientX: x, clientY: y });
            const fr = from.getBoundingClientRect();
            const x0 = fr.left + fr.width / 2, y0 = fr.top + 10;
            const fire = (type, target, t) => target.dispatchEvent(new TouchEvent(type, { bubbles: true, cancelable: true, touches: type === "touchend" ? [] : [t], changedTouches: [t] }));
            fire("touchstart", from, pt(from, x0, y0));
            await new Promise((r) => setTimeout(r, 450));
            const tr = to.getBoundingClientRect();
            fire("touchmove", from, pt(from, tr.left + tr.width / 2, tr.top + 10));
            fire("touchend", from, pt(from, tr.left + tr.width / 2, tr.top + 10));
            return [from.dataset.bar, to.dataset.bar];
          }, barBox.bar);
          await sleep(300);
          if (range) {
            const txt = await page.evaluate(() => [...document.querySelectorAll("[data-transport] button")].map((b) => b.getAttribute("aria-label") || "").join("|"));
            check(`${tag}: hold and drag extends the loop`, txt.includes(`Loop bars ${range[0]}\u2013${range[1]}`), txt.slice(0, 80));
          }
        }

        // More sheet opens and scrolls within the viewport.
        await page.evaluate(() => document.querySelector("[aria-label='More controls']")?.click());
        await sleep(500);
        await page.screenshot({ path: path.join(OUT, `more-${tag}.png`) });
        await layoutChecks(`${tag} more sheet`)(page);
        const dlg = await rectOf(page, "[role=dialog]");
        check(`${tag}: More sheet inside viewport`, !!dlg && dlg.top >= -1 && dlg.bottom <= s.h + 1, dlg ? `${Math.round(dlg.top)}..${Math.round(dlg.bottom)}` : "none");
        await page.keyboard.press("Escape");
        await sleep(400);

        // Play: follow-scroll still moves the sheet.
        // The loop picked above would keep playback on its two bars: switch it off first.
        await page.evaluate(() => document.querySelector("[data-transport] [aria-pressed=true][aria-label^=Loop]")?.click());
        await page.evaluate(() => { const e = document.querySelector(".sheet-scroll"); e.scrollTop = 0; });
        await sleep(200);
        await page.evaluate(() => document.querySelector("[aria-label='Play']")?.click());
        await sleep(300);
        await page.screenshot({ path: path.join(OUT, `playing-${tag}.png`) });
        if (s.w === 390) {
          await sleep(9000); // count-in is off; bars last 2.4s each, so the sheet must have followed to a later row
          const top = await page.evaluate(() => document.querySelector(".sheet-scroll").scrollTop);
          check(`${tag}: sheet follows the playing position`, top > 20, `scrollTop ${Math.round(top)}`);
        }
        await page.evaluate(() => document.querySelector("[aria-label='Pause']")?.click());

        check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));

        // Tuner and Metronome (portrait phone + tablet sizes only need a pass; landscape also checked).
        await page.goto(URL, { waitUntil: "networkidle0" });
        for (const name of ["Tuner", "Metronome"]) {
          await clickText(page, name);
          await sleep(400);
          await page.screenshot({ path: path.join(OUT, `${name.toLowerCase()}-${tag}.png`) });
          await layoutChecks(`${tag} ${name}`)(page);
          await page.goto(URL, { waitUntil: "networkidle0" });
        }
        if (s.w === 390 && theme === "dark") {
          await seedSong(page, DENSE, "Dense run");
          await sleep(300);
          const d = await page.evaluate(() => ({ pageOver: document.documentElement.scrollWidth - innerWidth, screenOver: document.querySelector(".screen").scrollWidth - document.querySelector(".screen").clientWidth, sheetOver: (() => { const e = document.querySelector(".sheet-scroll"); return e.scrollWidth - e.clientWidth; })() }));
          await page.screenshot({ path: path.join(OUT, `dense-${tag}.png`) });
          check(`${tag}: wide sheet scrolls inside itself, not the page`, d.pageOver <= 0 && d.screenOver <= 0 && d.sheetOver > 0, JSON.stringify(d));
        }
        check(`${tag}: no page errors after tuner/metronome`, errors.length === 0, errors.join(" | "));
        await page.close();
      }
    }
    console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
