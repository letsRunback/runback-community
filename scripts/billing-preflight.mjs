#!/usr/bin/env node
/**
 * Can a customer actually buy, and will their plan actually upgrade?
 *
 *   DOTENV_CONFIG_PATH=web/.env.local node -r dotenv/config scripts/billing-preflight.mjs
 *
 * Checkout creation and the webhook lifecycle were both verified against
 * production with signed payloads, but neither answers the question a first
 * customer answers for you: is the configuration in *this* environment
 * internally consistent, right now.
 *
 * The failure this exists to catch is specific and silent. Webhooks in Lemon
 * Squeezy are per-store and do not follow a store switch, so a cutover leaves
 * checkout working perfectly while nothing listens for the result — the
 * customer pays, the money arrives, and their plan never changes. Nothing in
 * the app can detect that; it simply never hears anything.
 *
 * Read-only. Creates nothing, charges nothing.
 */
const KEY = process.env.LEMONSQUEEZY_API_KEY;
const STORE = process.env.LEMONSQUEEZY_STORE_ID;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
const VARIANTS = {
  starter: process.env.LEMONSQUEEZY_VARIANT_STARTER,
  growth: process.env.LEMONSQUEEZY_VARIANT_GROWTH,
  scale: process.env.LEMONSQUEEZY_VARIANT_SCALE,
  pro: process.env.LEMONSQUEEZY_VARIANT_PRO,
};

const ls = async (path) => {
  const r = await fetch(`https://api.lemonsqueezy.com/v1${path}`, {
    headers: { Accept: "application/vnd.api+json", Authorization: `Bearer ${KEY}` },
  });
  return { status: r.status, body: r.ok ? await r.json() : null };
};

const problems = [];
const warn = [];
const fail = (m) => problems.push(m);

if (!KEY) {
  console.error("LEMONSQUEEZY_API_KEY is not set in this environment.");
  process.exit(1);
}
if (!STORE) {
  console.error("LEMONSQUEEZY_STORE_ID is not set in this environment.");
  process.exit(1);
}
if (!process.env.LEMONSQUEEZY_WEBHOOK_SECRET) {
  fail("LEMONSQUEEZY_WEBHOOK_SECRET is not set — every webhook will fail signature verification, so no purchase will ever upgrade a plan.");
}

/* ── Store ──────────────────────────────────────────────────────────────── */
const store = await ls(`/stores/${STORE}`);
if (store.status !== 200) {
  console.log(`NOT READY — store ${STORE} returns ${store.status}. Under review, or invisible to this key.`);
  process.exit(1);
}
const sa = store.body.data.attributes;
console.log(`store ${STORE}: "${sa.name}"  currency=${sa.currency}  total_sales=${sa.total_sales}`);

/* ── Variants ───────────────────────────────────────────────────────────── */
console.log("\nvariants");
let testModeSeen = false;
for (const [plan, id] of Object.entries(VARIANTS)) {
  if (!id) { warn.push(`${plan}: no variant configured — that tier cannot be purchased.`); continue; }
  const v = await ls(`/variants/${id}`);
  if (v.status !== 200) { fail(`${plan}: variant ${id} returns ${v.status} — checkout would 404.`); continue; }
  const va = v.body.data.attributes;
  const p = await ls(`/products/${va.product_id}`);
  const pa = p.status === 200 ? p.body.data.attributes : null;

  if (pa && String(pa.store_id) !== String(STORE)) {
    fail(`${plan}: variant ${id} belongs to store ${pa.store_id}, not ${STORE}. Prices and payouts would come from the wrong store.`);
  }
  // A single-variant product leaves its variant "pending" by design; the
  // product's own status is what decides whether it can be bought.
  if (pa && pa.status !== "published") {
    fail(`${plan}: product "${pa.name}" is ${pa.status}, not published — a draft still mints a checkout URL but cannot complete a sale, so the failure lands on the customer.`);
  }
  if (va.test_mode) testModeSeen = true;
  const price = (va.price / 100).toFixed(2);
  console.log(`  ${plan.padEnd(8)} variant=${id} ${sa.currency} ${price.padStart(9)}  product=${pa?.status ?? "?"}  test_mode=${va.test_mode}`);
}

/* ── Webhook: the silent one ────────────────────────────────────────────── */
console.log("\nwebhook");
const REQUIRED = ["subscription_created", "subscription_updated", "subscription_expired"];
const hooks = await ls("/webhooks");
const mine = (hooks.body?.data ?? []).filter((h) => String(h.attributes.store_id) === String(STORE));
const expectUrl = `${APP_URL.replace(/\/$/, "")}/api/billing/webhook`;
const match = mine.find((h) => h.attributes.url === expectUrl);

if (!mine.length) {
  fail(`no webhook on store ${STORE}. Checkout will work and nothing will listen: the customer pays and their plan never changes.`);
} else if (!match) {
  fail(`no webhook points at ${expectUrl}. Found: ${mine.map((h) => h.attributes.url).join(", ")}`);
} else {
  const missing = REQUIRED.filter((e) => !match.attributes.events.includes(e));
  if (missing.length) fail(`webhook ${match.id} is missing required events: ${missing.join(", ")}`);
  if (match.attributes.test_mode !== testModeSeen) {
    warn.push(`webhook test_mode=${match.attributes.test_mode} but variants test_mode=${testModeSeen}. Test mode has its own webhooks; a test purchase will not reach this one.`);
  }
  console.log(`  ${match.id} -> ${match.attributes.url}`);
  console.log(`  events ok (${REQUIRED.length}/${REQUIRED.length}), last_sent_at=${match.attributes.last_sent_at ?? "never"}`);
}

if (testModeSeen && process.env.LEMONSQUEEZY_ALLOW_TEST_MODE !== "1") {
  warn.push("variants are in test mode but LEMONSQUEEZY_ALLOW_TEST_MODE is not 1, so this deployment will acknowledge test webhooks and change nothing. That is the correct default for production — set it only on staging.");
}

/* ── Verdict ────────────────────────────────────────────────────────────── */
console.log("");
for (const w of warn) console.log(`WARN  ${w}`);
for (const p of problems) console.log(`FAIL  ${p}`);
if (problems.length) {
  console.log(`\nNOT READY — ${problems.length} blocking problem(s).`);
  process.exit(1);
}
console.log(warn.length ? "\nREADY (with warnings above)." : "\nREADY — a customer can buy and the upgrade will land.");
