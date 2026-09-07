/* Records the "watch replay fix a bug" public demo artifact:
     broken run → open Inspector → jump to the LLM step → Replay tab →
     edit the malformed address → re-run → (fixed) success.

   Two modes:

   1. Default (no RB_SESSION_COOKIE) — drives the fully public,
      zero-auth flow at /runs/demo-email-agent (seed it first: `npm run seed`).
      This exercises the real UI end to end and is a good smoke check, but on
      a deployment with RUNBACK_DEMO_MODE=1 the Replay call is answered by the
      zero-cost simulator (web/lib/replay/simulate.ts), which — for a same-model
      edited replay — echoes back the ORIGINALLY CAPTURED tool call unchanged
      (it varies tone/latency/tokens by model tier, not by re-deriving a tool
      call from edited text). So this mode will NOT show the bug as fixed —
      it's a UI/flow smoke check only, not the marketing recording.

   2. Authentic recording (RB_SESSION_COOKIE=<session cookie value> set) — signs
      in as an account with the `step_replay` feature and a real model key
      configured (Settings → Model keys), so the edit triggers a REAL replay
      call and the "Now" card genuinely shows send_email succeeding on the
      corrected address. Use this mode to capture the actual public artifact;
      never expose this cookie or run this mode against the public zero-auth
      demo path.

   Usage:
     npm run seed                                  # seed the fixture first
     BASE=http://localhost:3000 node scripts/demo-record.cjs
     BASE=http://localhost:3000 RB_SESSION_COOKIE=... node scripts/demo-record.cjs

   Exits 0/1 like _ttproof.cjs so it can double as a smoke check, not just a
   recorder. */
const { chromium } = require("playwright");
const fs = require("fs");

const BASE = process.env.BASE || "http://localhost:3000";
const RUN_ID = process.env.FIXTURE_RUN_ID || "demo-email-agent";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/runback-demo-record";
const SESSION_COOKIE = process.env.RB_SESSION_COOKIE || null;
const REAL_REPLAY = !!SESSION_COOKIE;
fs.mkdirSync(SHOT_DIR, { recursive: true });

const fails = [];
const ok = (m) => console.log("  ✓ " + m);
const bad = (m) => { console.log("  ✗ " + m); fails.push(m); };

(async () => {
  const browser = await chromium.launch();
  const ctxOpts = {
    viewport: { width: 1280, height: 850 },
    recordVideo: { dir: SHOT_DIR },
  };
  const ctx = await browser.newContext(ctxOpts);

  if (SESSION_COOKIE) {
    const url = new URL(BASE);
    await ctx.addCookies([{
      name: "rb_session",
      value: SESSION_COOKIE,
      domain: url.hostname,
      path: "/",
      secure: url.protocol === "https:",
      httpOnly: true,
      sameSite: "Lax",
    }]);
  }

  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e).slice(0, 140)));
  page.on("console", (m) => m.type() === "error" && errs.push(m.text().slice(0, 140)));

  console.log(`GATE → ${BASE}/runs/${RUN_ID}  (${REAL_REPLAY ? "authentic replay" : "demo-mode smoke check"})\n`);

  // ── 1. Load the run — the public/authed viewer ──────────────────────────
  const resp = await page.goto(`${BASE}/runs/${RUN_ID}`, { waitUntil: "networkidle", timeout: 20000 }).catch(() => null);
  (resp && resp.status() < 400) ? ok(`run loads (${resp.status()})`) : bad(`run failed to load (${resp ? resp.status() : "no response"})`);
  await page.screenshot({ path: `${SHOT_DIR}/01-run-loaded.png` }).catch(() => {});

  // ── 2. Switch to Inspect mode (default view is Time-travel) ─────────────
  await page.locator(".shell-modebtn", { hasText: "Inspect" }).click().catch(() => {});
  ((await page.locator(".shell-body").isVisible().catch(() => false)))
    ? ok("switched to Inspect mode")
    : bad("could not switch to Inspect mode");

  // ── 3. Select the failing LLM step (l3 — the tool-call-producing step) ──
  // Default selection on entering Inspect is error-first, which lands on the
  // failing TOOL step (t3); jump to l3, the LLM step that requested it, so
  // the Replay tab (LLM-only) is available.
  await page.locator("#row-l3").click().catch(() => {});
  ((await page.locator(".insp-tabs").isVisible().catch(() => false)))
    ? ok("LLM step selected — inspector open")
    : bad("could not select the LLM step");
  await page.screenshot({ path: `${SHOT_DIR}/02-step-selected.png` }).catch(() => {});

  // ── 4. Context tab (default) — shows the malformed address in the task ──
  const hasMalformed = await page.getByText(/jordan\[at\]example\.com/).first().isVisible().catch(() => false);
  hasMalformed ? ok("Context tab shows the malformed address") : bad("malformed address not visible in Context");
  await page.screenshot({ path: `${SHOT_DIR}/03-context-malformed-address.png` }).catch(() => {});

  // ── 5. Response tab — shows the SMTP error via the causal tool step ─────
  // (l3 itself has no error — the failure surfaces on t3; jump there via the
  // Timeline for a screenshot of the actual SMTP 550 error.)
  await page.locator("#row-t3").click().catch(() => {});
  const hasSmtpError = await page.getByText(/SMTP 550/).first().isVisible().catch(() => false);
  hasSmtpError ? ok("tool step shows the SMTP 550 error") : bad("SMTP error not visible on tool step");
  await page.screenshot({ path: `${SHOT_DIR}/04-tool-error.png` }).catch(() => {});

  // ── 6. Back to l3 → Replay tab → edit the address → run replay ──────────
  await page.locator("#row-l3").click().catch(() => {});
  await page.locator(".insp-tab", { hasText: "Replay" }).click().catch(() => {});
  const replayPanelVisible = await page.locator(".replay-btn").first().isVisible().catch(() => false);
  replayPanelVisible ? ok("Replay tab open") : bad("Replay tab did not open");

  // textarea order: [0]=system prompt, [1]=user message (contains the task +
  // malformed address), [2]=assistant message. Edit index 1.
  const userTextarea = page.locator(".replay-edit").nth(1);
  const original = await userTextarea.inputValue().catch(() => "");
  const fixed = original.replace("jordan[at]example.com", "jordan@example.com");
  if (fixed === original) bad("could not find the malformed address in the editable message");
  await userTextarea.fill(fixed).catch(() => {});
  await page.screenshot({ path: `${SHOT_DIR}/05-address-edited.png` }).catch(() => {});

  await page.locator(".replay-btn:not(.ghost)").click().catch(() => {});
  await page.locator(".replay-compare, .callout-error").first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.screenshot({ path: `${SHOT_DIR}/06-replay-result.png` }).catch(() => {});

  const replayFailed = await page.locator(".callout-error").first().isVisible().catch(() => false);
  const nowCard = page.locator('.replay-card[data-accent]');
  const nowVisible = await nowCard.isVisible().catch(() => false);

  if (replayFailed) {
    bad("replay call errored");
  } else if (!nowVisible) {
    bad("no 'Now' comparison card rendered");
  } else if (!REAL_REPLAY) {
    console.log("  ⚠ demo-mode result captured — NOT proof of a fix (simulator echoes the captured tool call for a same-model edit; see header comment). Re-run with RB_SESSION_COOKIE for the authentic recording.");
  } else {
    const nowText = await nowCard.textContent().catch(() => "");
    const stillMalformed = nowText.includes("jordan[at]example.com");
    stillMalformed ? bad("authentic replay still shows the malformed address") : ok("authentic replay shows the corrected address / success");
  }

  errs.length === 0 ? ok("no console/page errors") : bad("console errors: " + errs.slice(0, 2).join(" | "));

  await ctx.close();
  await browser.close();
  console.log(`\n${fails.length === 0 ? "✅ RECORDING PASSED" : "❌ RECORDING FAILED (" + fails.length + " issue" + (fails.length > 1 ? "s" : "") + ")"}  ·  output → ${SHOT_DIR}`);
  process.exit(fails.length === 0 ? 0 : 1);
})().catch((e) => { console.log("FATAL:", e.message); process.exit(1); });
