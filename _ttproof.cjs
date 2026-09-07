/* Runback pre-ship gate. Drives a real browser over every key page on desktop
   AND mobile, asserting: page loads, no console/page errors, no horizontal
   overflow, plus the time-travel feature works. Screenshots key pages. Exits
   non-zero on any failure so it can gate a deploy.

   Usage:  BASE=http://localhost:3210 node _ttproof.cjs
           BASE=https://runback.dev   node _ttproof.cjs        (against prod)
   Or:     npm run gate                                        (builds+serves+gates) */
const { chromium, devices } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:3210";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/runback-gate";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const PAGES = [
  { path: "/", name: "home", shot: true },
  { path: "/how-it-works", name: "how-it-works" },
  { path: "/standard", name: "standard", shot: true },
  { path: "/why", name: "why", shot: true },
  { path: "/get-started", name: "get-started", shot: true },
  { path: "/login", name: "login", shot: true },
  { path: "/use-cases", name: "use-cases" },
  { path: "/pricing", name: "pricing" },
  { path: "/contact", name: "contact" },
  { path: "/enterprise", name: "enterprise", shot: true },
  { path: "/integrations", name: "integrations" },
  { path: "/runs", name: "runs" },
  { path: "/evals", name: "evals" },
  { path: "/datasets", name: "datasets" },
  { path: "/runs/demo-refund-agent", name: "run", shot: true, timetravel: true },
  { path: "/blog", name: "blog", shot: true },
  { path: "/blog/deterministic-data-race", name: "blog-post", shot: true },
  { path: "/blog/time-travel-replay-walkthrough", name: "blog-post-2" },
  { path: "/blog/hash-chained-audit-trail", name: "blog-post-3" },
  { path: "/blog/redact-before-it-leaves", name: "blog-post-4" },
  { path: "/blog/replay-from-step-n", name: "blog-post-5" },
  { path: "/blog/three-ways-to-wire-in-runback", name: "blog-post-6" },
  { path: "/security", name: "security", shot: true },
  { path: "/verify", name: "verify", shot: true },
  { path: "/press", name: "press" },
  { path: "/spec", name: "spec" },
  { path: "/proof", name: "proof" },
  { path: "/procurement", name: "procurement" },
  { path: "/support", name: "support" },
  { path: "/privacy", name: "privacy" },
  { path: "/terms", name: "terms" },
  { path: "/dpa", name: "dpa" },
  { path: "/vs", name: "vs-index" },
  { path: "/vs/langsmith", name: "vs-langsmith" },
  { path: "/vs/langfuse", name: "vs-langfuse" },
  { path: "/vs/helicone", name: "vs-helicone" },
  { path: "/vs/braintrust", name: "vs-braintrust" },
  { path: "/vs/arize", name: "vs-arize" },
  { path: "/vs/traceloop", name: "vs-traceloop" },
  { path: "/vs/portkey", name: "vs-portkey" },
  { path: "/demo", name: "demo" },
];

const fails = [];
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fails.push(m); };
const dismiss = async (p) => { await p.getByRole("button", { name: "Got it" }).click({ timeout: 3500 }).catch(() => {}); };

async function checkTimeTravel(page) {
  (await page.getByText("Time-travel replay").first().isVisible().catch(() => false)) ? ok("run: opens in Time-travel by default") : bad("run: Time-travel not default");
  (await page.getByText(/deterministic · offline/).first().isVisible().catch(() => false)) ? ok("run: offline badge present") : bad("run: offline badge missing");
  const counter = page.locator(".tt-frame").first();
  await page.locator('.tt-btn[title="Start (Home)"]').click().catch(() => {});
  const start = (await counter.textContent().catch(() => ""))?.trim();
  await page.locator('.tt-btn[title="Forward (→)"]').click().catch(() => {});
  const fwd = (await counter.textContent().catch(() => ""))?.trim();
  (/^frame 1 \//.test(start || "")) ? ok("run: Home rewinds to frame 1") : bad("run: Home didn't rewind (" + start + ")");
  (/^frame 2 \//.test(fwd || "")) ? ok("run: Forward steps to frame 2") : bad("run: Forward didn't advance (" + fwd + ")");
  await page.locator('.tt-btn[title="End (End)"]').click().catch(() => {});
  ((await page.locator(".tt-step[data-fail='true']").count()) > 0) ? ok("run: failure step flagged") : bad("run: no failure step");
  ((await page.locator(".tt-msg").count()) > 0) ? ok("run: transcript renders") : bad("run: transcript empty");
}

(async () => {
  const browser = await chromium.launch();
  // wait for the server (handles `npm run gate` boot)
  let up = false;
  const probe = await browser.newPage();
  for (let i = 0; i < 40 && !up; i++) {
    try { const r = await probe.goto(BASE + "/", { timeout: 4000 }); if (r && r.status() < 500) up = true; } catch { await new Promise((r) => setTimeout(r, 1000)); }
  }
  await probe.close();
  if (!up) { console.log("FATAL: server not reachable at " + BASE); process.exit(1); }
  console.log("GATE → " + BASE + "\n");

  for (const pg of PAGES) {
    console.log(pg.path);
    // ── Desktop: loads, no errors, (time-travel), screenshot ──
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 850 } });
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
    page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));
    const resp = await page.goto(BASE + pg.path, { waitUntil: "networkidle", timeout: 20000 }).catch(() => null);
    await dismiss(page);
    (resp && resp.status() < 400) ? ok(`loads (${resp ? resp.status() : "ERR"})`) : bad(`failed to load (${resp ? resp.status() : "no response"})`);
    errs.length === 0 ? ok("no console/page errors") : bad("console errors: " + errs.slice(0, 2).join(" | "));
    if (pg.timetravel) await checkTimeTravel(page);
    if (pg.shot) await page.screenshot({ path: `${SHOT_DIR}/${pg.name}-desktop.png` }).catch(() => {});
    await ctx.close();

    // ── Mobile: no horizontal overflow, screenshot ──
    const mctx = await browser.newContext({ ...devices["iPhone 13"] });
    const mp = await mctx.newPage();
    await mp.goto(BASE + pg.path, { waitUntil: "networkidle", timeout: 20000 }).catch(() => {});
    await dismiss(mp);
    const ow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth).catch(() => -1);
    ow <= 1 ? ok("mobile: no horizontal overflow") : bad(`mobile: overflows by ${ow}px`);
    if (pg.shot) await mp.screenshot({ path: `${SHOT_DIR}/${pg.name}-mobile.png` }).catch(() => {});
    await mctx.close();
  }

  await browser.close();
  console.log(`\n${fails.length === 0 ? "✅ GATE PASSED" : "❌ GATE FAILED (" + fails.length + " issue" + (fails.length > 1 ? "s" : "") + ")"}  ·  screenshots → ${SHOT_DIR}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.log("FATAL:", e.message); process.exit(1); });
