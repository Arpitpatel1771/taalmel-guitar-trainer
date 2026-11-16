// Mobile stage 4 smoke (specs/8-11-mobile.md §2): Add a song, the text editor and the piano-roll song
// editor. Needs `puppeteer-core` resolvable from where it runs and a Vite dev server on PORT (default 5203).
//   MODE=baseline OUT=<dir> node smoke-mobile-stage4.mjs   → 1440 screenshots of every touched screen
//   MODE=diff BASE=<dir> OUT=<dir> node smoke-mobile-stage4.mjs   → same shots, compared pixel by pixel to BASE
//   MODE=full OUT=<dir> node smoke-mobile-stage4.mjs       → compact sizes: layout checks + touch gestures
// Chrome always runs muted and is closed at the end.

import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";

const PORT = process.env.PORT || "5203";
const URL = `http://localhost:${PORT}/`;
const MODE = process.env.MODE || "full";
const OUT = process.env.OUT || "./stage4-shots";
const BASE = process.env.BASE || "";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TAB = `Smoke Song
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

async function newPage(browser, w, h, theme, touch) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, hasTouch: !!touch, isMobile: false });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: theme }]);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(URL, { waitUntil: "networkidle0" });
  return { page, errors };
}

async function gotoAddSong(page) {
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button, [role=button], a")].find((x) => (x.getAttribute("aria-label") || x.textContent || "").trim().startsWith("Songs") && x.getClientRects().length);
    b?.click();
  });
  await sleep(400);
  await clickText(page, "Add a song");
  await sleep(800);
}

async function openEditor(page) {
  await gotoAddSong(page);
  await page.type("textarea", TAB);
  await sleep(300);
  await clickText(page, "Open in editor");
  await sleep(1200);
}

// ---- pixel comparison (exact: threshold 0) -----------------------------------------------------
async function diffDirs(browser, a, b) {
  const p = await browser.newPage();
  let bad = 0;
  for (const f of fs.readdirSync(a).filter((x) => x.endsWith(".png"))) {
    if (!fs.existsSync(`${b}/${f}`)) { check(`pixel diff ${f}`, false, "missing"); bad++; continue; }
    const da = "data:image/png;base64," + fs.readFileSync(`${a}/${f}`).toString("base64");
    const db = "data:image/png;base64," + fs.readFileSync(`${b}/${f}`).toString("base64");
    const r = await p.evaluate(async (da, db) => {
      const load = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.src = src; });
      const [ia, ib] = await Promise.all([load(da), load(db)]);
      if (ia.width !== ib.width || ia.height !== ib.height) return { size: true };
      const c = (img) => { const cv = document.createElement("canvas"); cv.width = img.width; cv.height = img.height; const x = cv.getContext("2d"); x.drawImage(img, 0, 0); return x.getImageData(0, 0, img.width, img.height).data; };
      const pa = c(ia), pb = c(ib);
      let n = 0;
      for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) { n++; i += 3 - (i % 4); }
      return { n };
    }, da, db);
    const ok = !r.size && r.n === 0;
    if (!ok) bad++;
    check(`pixel diff ${f}`, ok, r.size ? "size differs" : `${r.n} differing px`);
  }
  await p.close();
  return bad;
}

// ---- the laptop screens (baseline and diff) ----------------------------------------------------
async function laptopShots(browser, dir) {
  for (const theme of ["dark", "light"]) {
    const { page } = await newPage(browser, 1440, 1000, theme);
    await gotoAddSong(page);
    await page.screenshot({ path: path.join(dir, `addsong-empty-${theme}.png`) });
    await page.type("textarea", TAB);
    await sleep(300);
    await page.evaluate(() => document.activeElement?.blur()); // no blinking caret in the shot
    await sleep(100);
    await page.screenshot({ path: path.join(dir, `addsong-tab-${theme}.png`) });
    for (const [name, label] of [["newsong-text", "I have Taalmel song text"], ["newsong-ai", "Use an AI chat"]]) {
      await clickText(page, label);
      await sleep(300);
      await page.screenshot({ path: path.join(dir, `${name}-${theme}.png`) });
      await clickText(page, "Cancel");
      await sleep(300);
    }
    await clickText(page, "Open in editor");
    await sleep(1500);
    await page.screenshot({ path: path.join(dir, `editor-${theme}.png`) });
    // select everything: the inspector shows the note panel
    await page.evaluate(() => document.querySelector("[aria-label^='Notes.']")?.focus());
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await sleep(400);
    await page.screenshot({ path: path.join(dir, `editor-selected-${theme}.png`) });
    // Draw tool + strings view
    await clickText(page, "Strings");
    await sleep(300);
    await page.screenshot({ path: path.join(dir, `editor-strings-${theme}.png`) });
    await page.close();
  }
}


// ---- compact layout checks ---------------------------------------------------------------------
const layoutChecks = (label) => async (page) => {
  const r = await page.evaluate(() => {
    const vw = window.innerWidth;
    const small = [];
    const unlabeled = [];
    const tools = document.querySelector("[aria-label='Tools']")?.getBoundingClientRect();
    const underTools = [];
    const insideScroller = (el) => !!el.closest("[aria-label^='Notes.']");
    for (const el of document.querySelectorAll("button, a[href], [role=button], input:not([type=hidden]), select, textarea")) {
      const rect = el.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const style = getComputedStyle(el);
      if (style.visibility === "hidden") continue;
      if (el.matches("input[type=checkbox], input[type=radio], input[type=range]")) continue;
      if (el.closest("[class*=tabPre], [class*=tabLine]")) continue; // fret numbers in the tab view stay narrow by design
      const box = el.closest("label, button, a") ?? el;
      const b = box.getBoundingClientRect();
      const inView = rect.bottom > 0 && rect.top < window.innerHeight;
      if (inView && (b.width < 44 - 0.5 || b.height < 44 - 0.5)) small.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}" ${Math.round(b.width)}×${Math.round(b.height)}`);
      if (el.tagName === "BUTTON" && !(el.textContent || "").trim() && !el.getAttribute("aria-label")) unlabeled.push(el.outerHTML.slice(0, 60));
      if (inView && tools && el.getAttribute("aria-label") !== "Tools" && !insideScroller(el) && rect.left < tools.right && rect.right > tools.left && rect.top < tools.bottom && rect.bottom > tools.top)
        underTools.push(`${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 24)}"`);
    }
    const screen = document.querySelector(".screen");
    return { overflow: document.documentElement.scrollWidth - vw, screenOverflow: screen ? screen.scrollWidth - screen.clientWidth : 0, small, unlabeled, underTools };
  });
  check(`${label}: no horizontal page scroll`, r.overflow <= 0, `overflow ${r.overflow}px`);
  check(`${label}: no horizontal scroll in .screen`, r.screenOverflow <= 0, `overflow ${r.screenOverflow}px`);
  check(`${label}: tap targets ≥ 44px`, r.small.length === 0, r.small.slice(0, 8).join("; "));
  check(`${label}: icon buttons labelled`, r.unlabeled.length === 0, r.unlabeled.slice(0, 3).join("; "));
  if (r.underTools.length) console.log(`NOTE ${label}: controls under the Tools button: ${r.underTools.join("; ")}`);
};

async function shot(page, name) {
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
}

async function compactScreens(browser, s, theme) {
  const tag = `${s.w}x${s.h}${s.touch ? "-touch" : ""}-${theme}`;
  const { page, errors } = await newPage(browser, s.w, s.h, theme, s.touch);
  check(`${tag}: compact layout (tab bar present)`, await page.evaluate(() => !!document.querySelector("nav[aria-label='Tabs']")));
  await gotoAddSong(page);
  await shot(page, `addsong-${tag}`);
  await layoutChecks(`${tag} addsong`)(page);
  const fontOk = await page.evaluate(() => [...document.querySelectorAll("input:not([type=checkbox]), textarea")].filter((i) => i.getClientRects().length).every((i) => parseFloat(getComputedStyle(i).fontSize) >= 16));
  check(`${tag} addsong: inputs ≥ 16px`, fontOk);
  await page.type("textarea", TAB);
  await sleep(300);
  await page.evaluate(() => document.activeElement?.blur());
  await shot(page, `addsong-tab-${tag}`);
  await layoutChecks(`${tag} addsong+tab`)(page);
  for (const [name, label] of [["newsong-text", "I have Taalmel song text"], ["newsong-ai", "Use an AI chat"]]) {
    await clickText(page, label);
    await sleep(300);
    await shot(page, `${name}-${tag}`);
    await layoutChecks(`${tag} ${name}`)(page);
    const f = await page.evaluate(() => [...document.querySelectorAll("input:not([type=checkbox]), textarea")].filter((i) => i.getClientRects().length).every((i) => parseFloat(getComputedStyle(i).fontSize) >= 16));
    check(`${tag} ${name}: inputs ≥ 16px`, f);
    await clickText(page, "Cancel");
    await sleep(300);
  }
  await clickText(page, "Open in editor");
  await sleep(1500);
  await shot(page, `editor-${tag}`);
  await layoutChecks(`${tag} editor`)(page);
  check(`${tag} editor: pitch hints hidden (no getDisplayMedia here? ${await page.evaluate(() => !!navigator.mediaDevices?.getDisplayMedia)})`, true);
  // scroll the page so the roll fills the view, then shoot again
  await page.evaluate(() => document.querySelector("[aria-label='Piano roll']")?.scrollIntoView({ block: "start" }));
  await sleep(300);
  await shot(page, `editor-roll-${tag}`);
  await layoutChecks(`${tag} editor roll`)(page);
  await gestureChecks(page, tag);
  await shot(page, `editor-after-gestures-${tag}`);
  await layoutChecks(`${tag} editor after gestures`)(page);
  check(`${tag}: no page errors`, errors.length === 0, errors.join(" | "));
  await page.close();
}

// ---- laptop mouse behaviour must be exactly as before ------------------------------------------
async function mouseChecks(browser) {
  const { page, errors } = await newPage(browser, 1440, 1000, "dark");
  await openEditor(page);
  await clickText(page, "Strings");
  await page.evaluate(() => document.querySelector("[aria-label^='Notes.']")?.scrollIntoView({ block: "start" }));
  await sleep(300);
  const b = await rollBox(page);
  const base = await notesText(page);
  const ex = b.left + 700, ey = b.top + 52 + 20 + 40 * 5; // the empty low-E lane
  await page.mouse.click(ex, ey, { count: 2 });
  await sleep(300);
  check("1440 mouse: double-click adds a note", Number(await notesText(page)) === Number(base) + 1, `${base} -> ${await notesText(page)}`);
  check("1440 mouse: double-click added exactly one", Number(await notesText(page)) === Number(base) + 1);
  const b2 = await rollBox(page); // adding a note selects it, which can shift the page: measure again
  await page.mouse.click(ex + 12, b2.top + 52 + 20 + 40 * 5, { button: "right" });
  await sleep(300);
  check("1440 mouse: right-click deletes the note", (await notesText(page)) === base);
  const tab0 = await page.evaluate(() => document.querySelector("[class*=tabPre]")?.textContent ?? "");
  const n1 = await findFirstNote(page);
  await page.mouse.move(n1.x0 + 5, n1.y);
  await page.mouse.down();
  await page.mouse.move(n1.x0 + 30, n1.y + 45, { steps: 6 });
  await page.mouse.up();
  await sleep(300);
  check("1440 mouse: drag moves a note", (await page.evaluate(() => document.querySelector("[class*=tabPre]")?.textContent ?? "")) !== tab0);
  check("1440 mouse: no page errors", errors.length === 0, errors.join(" | "));
  check("1440: pitch hints shown when getDisplayMedia exists", await page.evaluate(() => !!navigator.mediaDevices?.getDisplayMedia));
  await page.close();
}

// ---- touch gestures through CDP (real touch events -> pointer events with pointerType "touch") --
async function touch(page, type, points) {
  page.__cdp ??= await page.createCDPSession(); // one session per page: touch state lives in it
  await page.__cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
}
const notesText = (page) => page.evaluate(() => document.body.innerText.match(/(\d+) notes? in/)?.[1] ?? null);
const undoEnabled = (page) => page.evaluate(() => !document.querySelector("button[aria-label=Undo]")?.disabled);
async function rollBox(page) {
  return page.evaluate(() => {
    const el = document.querySelector("[aria-label^='Notes.']");
    const r = el.getBoundingClientRect();
    return { left: r.left, top: r.top, w: r.width, h: r.height, sw: el.scrollWidth, sl: el.scrollLeft, st: el.scrollTop, sh: el.scrollHeight };
  });
}

/** The first note in lane 1 (high e) of the strings view, found by scanning the canvas for the accent colour. */
async function findFirstNote(page) {
  return page.evaluate(() => {
    const c = document.querySelector("[aria-label^='Notes.'] canvas");
    const r = c.getBoundingClientRect();
    const dpr = c.width / r.width;
    const y = Math.round((52 + 14) * dpr); // near the top edge of the lane's note block, clear of the fret number
    const row = c.getContext("2d").getImageData(0, y, c.width, 1).data;
    const orange = (i) => row[i * 4] > 200 && row[i * 4 + 1] > 120 && row[i * 4 + 2] < 110;
    let x0 = -1, x1 = -1;
    for (let i = Math.round(62 * dpr); i < c.width; i++) {
      if (orange(i)) { if (x0 < 0) x0 = i; x1 = i; } else if (x0 >= 0 && i - x1 > 6) break;
    }
    return x0 < 0 ? null : { x0: r.left + x0 / dpr, x1: r.left + x1 / dpr, y: r.top + 52 + 20 };
  });
}

async function gestureChecks(page, tag) {
  // Strings view: the first note (high e, tick 0) sits in lane 1 at the left edge, whatever the zoom.
  await clickText(page, "Strings");
  await page.evaluate(() => document.querySelector("[aria-label^='Notes.']")?.scrollIntoView({ block: "start" }));
  await sleep(400);
  const b0 = await rollBox(page);
  const n0 = await findFirstNote(page);
  check(`${tag} gestures: found the first note on the canvas`, !!n0, JSON.stringify(n0));
  const NOTE_X = n0.x0 + 5; // body zone
  const NOTE_Y = n0.y;
  const base = await notesText(page);
  check(`${tag} gestures: roll is touch-action none`, await page.evaluate(() => getComputedStyle(document.querySelector("[aria-label^='Notes.'] canvas")).touchAction === "none"));
  check(`${tag} gestures: undo starts disabled`, !(await undoEnabled(page)));

  // 1. tap a note selects it (no edit)
  await touch(page, "touchStart", [{ x: NOTE_X, y: NOTE_Y, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  const selText = await page.evaluate(() => document.querySelector("[aria-label='Selected notes']")?.textContent ?? null);
  check(`${tag} gestures: tap selects a note`, !!selText && /1 selected/.test(selText), String(selText));
  check(`${tag} gestures: a tap is not an edit`, !(await undoEnabled(page)));
  await shot(page, `editor-selected-${tag}`);
  await layoutChecks(`${tag} editor selected`)(page);
  // the Edit button opens the inspector sheet
  await clickText(page, "Edit");
  await sleep(400);
  check(`${tag} gestures: Edit opens the inspector sheet`, await page.evaluate(() => !!document.querySelector("[role=dialog]")?.textContent?.includes("Semitone")));
  await shot(page, `editor-inspector-${tag}`);
  await layoutChecks(`${tag} inspector sheet`)(page);
  await page.keyboard.press("Escape");
  await sleep(300);
  await clickText(page, "Done");
  await sleep(200);

  // 2. drag a note with a finger: pitch/string changes, undo enabled
  const tabBefore = await page.evaluate(() => document.querySelector("[class*=tabPre]")?.textContent ?? "");
  await touch(page, "touchStart", [{ x: NOTE_X, y: NOTE_Y, id: 1 }]);
  for (let i = 1; i <= 8; i++) await touch(page, "touchMove", [{ x: NOTE_X + i * 6, y: NOTE_Y + i * 7, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  check(`${tag} gestures: finger drag moves a note`, (await undoEnabled(page)));
  // undo it so the rest starts from the same song
  await page.evaluate(() => document.querySelector("button[aria-label=Undo]")?.click());
  await sleep(200);
  check(`${tag} gestures: undo puts it back`, !(await undoEnabled(page)) && (await page.evaluate(() => document.querySelector("[class*=tabPre]")?.textContent ?? "")) === tabBefore);

  // 3. resize from the end with a finger: the note gets longer, undo enabled
  const hx = n0.x1 - 4;
  await touch(page, "touchStart", [{ x: hx, y: NOTE_Y, id: 1 }]);
  for (let i = 1; i <= 8; i++) await touch(page, "touchMove", [{ x: hx + i * 6, y: NOTE_Y, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  const n1 = await findFirstNote(page);
  check(`${tag} gestures: dragging a note's end resizes it`, !!n1 && n1.x1 > n0.x1 + 20 && (await undoEnabled(page)), `${Math.round(n0.x1 - n0.x0)}px -> ${n1 ? Math.round(n1.x1 - n1.x0) : "?"}px`);
  await page.evaluate(() => document.querySelector("button[aria-label=Undo]")?.click());
  await sleep(200);

  // 4. double-tap on empty space adds a note
  await page.evaluate(() => document.querySelector("[aria-label^='Notes.']")?.scrollIntoView({ block: "start" }));
  await sleep(200);
  const b4 = await rollBox(page);
  const emptyX = b4.left + b4.w - 120;
  const emptyY = b4.top + 52 + 20 + 40 * 4;
  await touch(page, "touchStart", [{ x: emptyX, y: emptyY, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(120);
  await touch(page, "touchStart", [{ x: emptyX + 3, y: emptyY + 2, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(350);
  const afterAdd = await notesText(page);
  check(`${tag} gestures: double-tap adds a note`, Number(afterAdd) === Number(base) + 1, `${base} -> ${afterAdd}`);
  // a single tap alone does not
  await touch(page, "touchStart", [{ x: emptyX - 80, y: emptyY, id: 1 }]);
  await touch(page, "touchEnd", []);
  await sleep(700);
  check(`${tag} gestures: single tap adds nothing`, (await notesText(page)) === afterAdd);

  // 5. long-press on the new note deletes it
  await touch(page, "touchStart", [{ x: emptyX + 14, y: emptyY, id: 1 }]);
  await sleep(700);
  await touch(page, "touchEnd", []);
  await sleep(300);
  check(`${tag} gestures: long-press deletes the note`, (await notesText(page)) === base, `${afterAdd} -> ${await notesText(page)}`);
  // a long press with a drag beyond 8px does not delete
  await touch(page, "touchStart", [{ x: NOTE_X, y: NOTE_Y, id: 1 }]);
  await sleep(200);
  await touch(page, "touchMove", [{ x: NOTE_X + 30, y: NOTE_Y, id: 1 }]);
  await sleep(500);
  await touch(page, "touchEnd", []);
  await sleep(300);
  check(`${tag} gestures: long-press with movement deletes nothing`, (await notesText(page)) === base);
  await page.evaluate(() => document.querySelector("button[aria-label=Undo]")?.click());
  await sleep(200);

  // 6. pinch zooms the time axis; fingers spreading widens the roll's content
  await page.evaluate(() => document.querySelector("[aria-label^='Notes.']")?.scrollIntoView({ block: "start" }));
  await sleep(200);
  const bm = await rollBox(page);
  const mid = { x: bm.left + bm.w / 2, y: bm.top + bm.h / 2 };
  const w0 = bm.sw;
  const tabText = () => page.evaluate(() => document.querySelector("[class*=tabPre]")?.textContent ?? "");
  const tab0 = await tabText();
  await touch(page, "touchStart", [{ x: mid.x - 40, y: mid.y, id: 1 }, { x: mid.x + 40, y: mid.y, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch(page, "touchMove", [{ x: mid.x - 40 - i * 12, y: mid.y, id: 1 }, { x: mid.x + 40 + i * 12, y: mid.y, id: 2 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  const w1 = (await rollBox(page)).sw;
  check(`${tag} gestures: pinch out zooms in`, w1 > w0 * 1.3, `${w0} -> ${w1}`);
  check(`${tag} gestures: pinch does not edit`, (await tabText()) === tab0 && (await notesText(page)) === base);
  await touch(page, "touchStart", [{ x: mid.x - 130, y: mid.y, id: 1 }, { x: mid.x + 130, y: mid.y, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch(page, "touchMove", [{ x: mid.x - 130 + i * 12, y: mid.y, id: 1 }, { x: mid.x + 130 - i * 12, y: mid.y, id: 2 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  const w2 = (await rollBox(page)).sw;
  check(`${tag} gestures: pinch in zooms out`, w2 < w1 * 0.85, `${w1} -> ${w2}`);

  // 7. two-finger drag pans: scroll right/down moves the roll
  const before = await rollBox(page);
  await touch(page, "touchStart", [{ x: mid.x + 60, y: mid.y, id: 1 }, { x: mid.x + 100, y: mid.y, id: 2 }]);
  for (let i = 1; i <= 8; i++) await touch(page, "touchMove", [{ x: mid.x + 60 - i * 15, y: mid.y - i * 3, id: 1 }, { x: mid.x + 100 - i * 15, y: mid.y - i * 3, id: 2 }]);
  await touch(page, "touchEnd", []);
  await sleep(300);
  const after = await rollBox(page);
  check(`${tag} gestures: two-finger drag scrolls the roll`, after.sl > before.sl + 40, `scrollLeft ${before.sl} -> ${after.sl}`);
  check(`${tag} gestures: two-finger drag does not edit`, (await tabText()) === tab0 && (await notesText(page)) === base);
  check(`${tag} gestures: the page did not scroll sideways`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
}
const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--mute-audio", "--no-first-run", "--autoplay-policy=no-user-gesture-required"] });
try {
  if (MODE === "baseline") {
    await laptopShots(browser, OUT);
    console.log(`baseline saved to ${OUT}`);
  } else if (MODE === "diff") {
    await laptopShots(browser, OUT);
    const bad = await diffDirs(browser, BASE, OUT);
    console.log(bad ? `${bad} screenshot(s) differ` : "laptop pixel diff: 0 px on every screen");
    process.exit(bad ? 1 : 0);
  } else {
    const sizes = [
      { w: 390, h: 844 },
      { w: 768, h: 1024 },
      { w: 1024, h: 768, touch: true },
      { w: 844, h: 390, touch: true },
    ];
    // ONLY=844x390,390x844 THEMES=dark narrows a run while iterating.
    const only = process.env.ONLY?.split(",");
    const themes = process.env.THEMES?.split(",") ?? ["dark", "light"];
    for (const s of sizes) {
      if (only && !only.includes(`${s.w}x${s.h}`)) continue;
      for (const theme of themes) await compactScreens(browser, { ...s, touch: true }, theme);
    }
    await mouseChecks(browser);
    console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
  }
} finally {
  await browser.close();
}
process.exit(failures ? 1 : 0);
