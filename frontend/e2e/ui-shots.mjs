
import fs from "node:fs";
import { chromium } from "playwright";

if (process.argv[2] === "--diff") {
  const [a, b] = process.argv.slice(3).map((l) => JSON.parse(fs.readFileSync(`e2e/screenshots/styles-${l}.json`, "utf8")));
  let n = 0;
  for (const screen of Object.keys(a)) {
    const A = a[screen], B = b[screen] || {};
    for (const k of new Set([...Object.keys(A), ...Object.keys(B)])) {
      if (k.includes("tl-past")) continue;
      if (A[k] !== B[k] && n++ < 40) console.log(`${screen} ${k}
  - ${A[k]}
  + ${B[k]}`);
    }
  }
  console.log(`${n} differences`);
  process.exit(n ? 1 : 0);
}
const [ui = "new", w = "1920", h = "1080"] = process.argv.slice(2);
const DUMP = process.env.DUMP, dump = {};
const PROPS = ["display", "position", "color", "background-color", "background-image", "font-size", "font-weight", "line-height", "letter-spacing",
  "padding", "margin", "border", "border-radius", "box-shadow", "gap", "opacity", "text-transform", "width", "height", "grid-template-columns", "flex", "cursor", "filter", "backdrop-filter"];
const BASE = process.env.DA_URL || "http://localhost:5173";
const LEAGUE = process.env.DA_LEAGUE || "tobedecided";
const THEME = process.env.THEME || "courtside";
const OUT = `e2e/screenshots/ui-${ui}-${w}${process.env.SCHEME ? "-" + process.env.SCHEME : ""}${THEME ? "-" + THEME : ""}`;
fs.mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ channel: process.env.DA_BROWSER || "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: +w, height: +h }, colorScheme: process.env.SCHEME || "light" });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

async function open(tab, ready) {
  await page.goto(BASE);
  await page.evaluate(([t, l, u, th]) => { localStorage.setItem("da.tab", t); localStorage.setItem("da.league", l); localStorage.setItem("da.ui", u === "new" ? "" : u); localStorage.setItem("da.theme", th); }, [tab, LEAGUE, ui, THEME]);
  await page.goto(BASE);
  if (ready) await (ready.startsWith("[") ? page.locator(ready) : page.getByTestId(ready)).first().waitFor();
  await page.waitForTimeout(1200);
}
const shot = async (name) => {
  await page.screenshot({ path: `${OUT}/${name}.png` });
  if (DUMP) dump[name] = await page.evaluate((props) => {
    const out = {};
    const path = (el) => el.parentElement ? `${path(el.parentElement)}>${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}:${[...el.parentElement.children].indexOf(el)}` : "html";
    for (const el of document.querySelectorAll("body *")) {
      if (el.closest("svg") && el.tagName !== "svg") continue;
      const cs = getComputedStyle(el);
      out[path(el)] = props.map((p) => cs.getPropertyValue(p)).join(" | ");
    }
    return out;
  }, PROPS);
};

try {
  await open("home", "home"); await shot("01-home");
  await open("season", '[data-testid^="open-"]'); await shot("02-week");
  await page.locator('[data-testid^="open-"]').first().click();
  await page.getByTestId("season-summary").waitFor(); await page.waitForTimeout(800); await shot("03-player-card");
  await page.locator(".profile-tabs button").nth(1).click(); await page.waitForTimeout(800); await shot("04-player-gamelog");
  await page.locator(".sp-score a, .sp-score .team-link, .sp-score [role=button]").first().click().catch(() => {});
  if (await page.getByTestId("team-panel").count()) { await page.waitForTimeout(800); await shot("05-team-card"); }
  if (await page.getByTestId("notif-bell").count()) { await page.getByTestId("notif-bell").click(); await page.waitForTimeout(300); await shot("06-notifications"); }
  await open("standings", "standings"); await shot("07-league");
  await open("news", "news-filters"); await shot("08-news");
  await open("waivers", "waivers"); await shot("09-waivers");
  await open("draft"); await shot("10-draft");
  await open("home", "home"); await page.getByTestId("tab-settings").click(); await page.waitForTimeout(800); await shot("11-settings");
} finally {
  await browser.close();
  if (DUMP) fs.writeFileSync(`e2e/screenshots/styles-${DUMP}.json`, JSON.stringify(dump));
  console.log(`${OUT}${errors.length ? `\nPAGE ERRORS:\n${errors.join("\n")}` : ""}`);
}
