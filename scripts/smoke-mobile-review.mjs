// Review fix-pass checks for mobile stage 1 (plans/8-11-mobile-stage1-plan.md, final review findings).
// Same requirements as smoke-mobile.mjs: puppeteer-core resolvable, Vite on PORT (default 5199).

import puppeteer from "puppeteer-core";

const URL = `http://localhost:${process.env.PORT || "5199"}/`;
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
};
const TAB = "Review Song\ne|-3h5p3--5---|-0--3--0--3--|\nB|-3----------|-1--0--1--0--|\nG|------------|-0--0--0--0--|\nD|------------|-2--0--2--0--|\nA|------------|-3--2--3--2--|\nE|------------|-------------|\n";
const click = (page, text, scope = "body") =>
  page.evaluate((text, scope) => {
    const el = [...document.querySelectorAll(`${scope} button, ${scope} [role=radio]`)].find((b) => (b.getAttribute("aria-label") || b.textContent || "").trim().startsWith(text) && b.getClientRects().length);
    if (!el) throw new Error(`no "${text}"`);
    el.click();
  }, text, scope);

const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--mute-audio", "--autoplay-policy=no-user-gesture-required"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: "networkidle0" });
  // Seed one song.
  await click(page, "Songs", "nav"); await sleep(300);
  await click(page, "Add a song"); await sleep(300);
  await page.type("textarea", TAB); await sleep(300);
  await click(page, "Open in editor"); await sleep(1200);
  await click(page, "Save song"); await sleep(1200);
  await page.goto(URL, { waitUntil: "networkidle0" });

  // 1. Ghost tap: a touch on the scrim above the song row must not open the song.
  await click(page, "Songs", "nav"); await sleep(400);
  await page.evaluate(() => document.querySelector("button[aria-label^='Actions for']").click()); await sleep(400);
  const row = await page.evaluate(() => { const r = document.querySelector("main li").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + 10 }; });
  await page.touchscreen.tap(row.x, row.y); await sleep(600);
  check("tap on sheet backdrop does not go through to the row below", await page.evaluate(() => !!document.querySelector("nav[aria-label='Tabs']")), "song opened");

  // 6. No screen scrolls sideways (long titles etc.).
  const screenOverflow = await page.evaluate(() => [...document.querySelectorAll(".screen")].map((s) => s.scrollWidth - s.clientWidth).filter((d) => d > 0));
  check("no .screen scrolls horizontally", screenOverflow.length === 0, screenOverflow.join(","));

  // 3. Free metronome running, then practice: the Tools sheet can stop it.
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.click("button[aria-label='Tools']"); await sleep(400);
  await click(page, "Start", "[role=dialog]"); await sleep(300);
  await page.keyboard.press("Escape"); await sleep(300);
  await click(page, "Songs", "nav"); await sleep(400);
  await page.evaluate(() => document.querySelector("main li button").click()); await sleep(1500);
  await page.click("button[aria-label='Tools']"); await sleep(400);
  check("practice: running free metronome can be stopped from Tools", await page.evaluate(() => [...document.querySelectorAll("[role=dialog] button")].some((b) => /stop/i.test(b.textContent))));
  await page.keyboard.press("Escape"); await sleep(300);

  // 5. Transport bar fits a phone screen.
  const pill = await page.evaluate(() => { const b = document.querySelector("button[aria-label='More controls']"); if (!b) return null; const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.left >= 0; });
  check("practice transport's More controls is on screen", pill === true, String(pill));

  // 2. Opening a sheet must not focus a text input (that raises the phone keyboard).
  await page.evaluate(() => document.querySelector("button[aria-label='More controls']")?.click()); await sleep(400);
  const focused = await page.evaluate(() => { const a = document.activeElement; return a ? a.tagName + (a.type ? `:${a.type}` : "") : "none"; });
  check("sheet opens without focusing a text field", !/^INPUT:(text|number|search)|^TEXTAREA/.test(focused), focused);
  await page.keyboard.press("Escape"); await sleep(300);

  // 4. Editor tab view: fret numbers stay compact (not 44px boxes) on a touch tablet.
  await page.setViewport({ width: 1024, height: 768, hasTouch: true, isMobile: true });
  // Compact practice keeps Edit in the header's "Song options" sheet.
  await page.evaluate(() => document.querySelector("button[aria-label='Song options']")?.click()); await sleep(400);
  await click(page, "Edit"); await sleep(1800);
  const cellW = await page.evaluate(() => { const c = [...document.querySelectorAll("pre button")]; return c.length ? Math.max(...c.map((b) => b.getBoundingClientRect().width)) : null; });
  check("editor tab view cells stay narrow", cellW !== null && cellW < 30, String(cellW));

  // 8. Stacked sheets: Esc closes only the top one.
  await page.setViewport({ width: 390, height: 844, hasTouch: true, isMobile: true });
  await page.goto(URL, { waitUntil: "networkidle0" });
  await click(page, "More", "nav"); await sleep(400);
  await page.evaluate(() => { const d = document.querySelector("[role=dialog]"); const b = d && [...d.querySelectorAll("button")].find((x) => /google|account|sign in/i.test(x.textContent + (x.getAttribute("aria-label") || ""))); b?.click(); }); await sleep(400);
  const before = await page.evaluate(() => document.querySelectorAll("[role=dialog]").length);
  await page.keyboard.press("Escape"); await sleep(300);
  const after = await page.evaluate(() => document.querySelectorAll("[role=dialog]").length);
  check("Esc closes only the top sheet", before < 2 || after === before - 1, `${before} → ${after}`);
  await page.close();

  // 7. Laptop: the Library list wrapper is not a size container (no stacking change for menus).
  const lp = await browser.newPage();
  await lp.setViewport({ width: 1440, height: 1000 });
  await lp.goto(URL, { waitUntil: "networkidle0" });
  await lp.evaluate(() => [...document.querySelectorAll("nav button")].find((x) => x.textContent.includes("Songs")).click()); await sleep(400);
  const ct = await lp.evaluate(() => { const ul = document.querySelector("main ul"); return ul ? getComputedStyle(ul.parentElement).containerType : null; });
  check("laptop: song list wrapper is not a container", ct === "normal", String(ct));
  await lp.close();
} finally {
  await browser.close();
}
console.log(failures ? `${failures} check(s) FAILED` : "all checks passed");
process.exit(failures ? 1 : 0);
