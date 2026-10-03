import { mkdirSync } from "node:fs";
import { chromium } from "playwright";

const BASE = "http://localhost:3457";
const OUT = "screenshots";
mkdirSync(OUT, { recursive: true });

const PAGES = [
  { path: "/", file: "01-overview.png" },
  { path: "/skills", file: "02-skills.png" },
  { path: "/skills/aihot", file: "03-detail.png" },
  { path: "/graph", file: "04-graph.png" },
  { path: "/sync", file: "05-sync.png" },
  { path: "/eval", file: "06-eval.png" },
];

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
for (const p of PAGES) {
  const started = Date.now();
  await page.goto(`${BASE}${p.path}`, { waitUntil: "networkidle", timeout: 60000 });
  await page.screenshot({ path: `${OUT}/${p.file}`, fullPage: true });
  console.log(`ok ${p.path} -> ${p.file} (${Date.now() - started}ms)`);
}
await browser.close();
