/**
 * The money path had no tests.
 *
 * `handleWebhook` is what turns a payment into an entitlement. Everything about
 * it is security-relevant — it accepts an unauthenticated POST from the public
 * internet and decides who is on a paid plan — and none of it was covered.
 *
 * The test-mode case is the reason this file exists now. Lemon Squeezy marks
 * test events with `meta.test_mode`, and the handler ignored the flag: a test
 * purchase, meaning a fake card and no money, would have upgraded a real org on
 * a real deployment. Test mode has its own signing secret and its own variant
 * ids, so an operator wiring up a test purchase copies production values across
 * until it works — and at that point nothing distinguishes the two.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";

const SECRET = "whsec_test_secret";
const STARTER_VARIANT = "1846101";

/** Rows the fake Supabase client was asked to write, so we can assert on effect. */
let updates: Record<string, unknown>[] = [];

vi.mock("@/lib/supabase/admin", () => ({
  getAdminClient: () => ({
    from: () => ({
      update: (patch: Record<string, unknown>) => {
        updates.push(patch);
        return { eq: () => Promise.resolve({ data: null, error: null }) };
      },
      select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null }) }) }),
    }),
  }),
}));

function signed(body: unknown): { raw: string; sig: string } {
  const raw = JSON.stringify(body);
  return { raw, sig: crypto.createHmac("sha256", SECRET).update(raw).digest("hex") };
}

function subscriptionEvent(opts: { testMode: boolean; orgId?: string }) {
  return {
    meta: {
      event_name: "subscription_created",
      test_mode: opts.testMode,
      custom_data: { org_id: opts.orgId ?? "org_real_customer" },
    },
    data: {
      id: "sub_123",
      attributes: {
        status: "active",
        variant_id: Number(STARTER_VARIANT),
        customer_id: 999,
        ends_at: null,
      },
    },
  };
}

const VARS = ["LEMONSQUEEZY_WEBHOOK_SECRET", "LEMONSQUEEZY_VARIANT_STARTER", "LEMONSQUEEZY_ALLOW_TEST_MODE"];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  updates = [];
  for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; }
  process.env.LEMONSQUEEZY_WEBHOOK_SECRET = SECRET;
  process.env.LEMONSQUEEZY_VARIANT_STARTER = STARTER_VARIANT;
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("test-mode webhooks", () => {
  it("do not change anyone's plan by default", async () => {
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const { raw, sig } = signed(subscriptionEvent({ testMode: true }));

    const res = await handleWebhook(raw, sig);
    expect(res.ok).toBe(true); // acknowledged, so LS stops retrying
    expect(updates).toEqual([]); // but nothing was written
  });

  it("are processed when a staging deployment opts in", async () => {
    process.env.LEMONSQUEEZY_ALLOW_TEST_MODE = "1";
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const { raw, sig } = signed(subscriptionEvent({ testMode: true }));

    await handleWebhook(raw, sig);
    expect(updates.length).toBe(1);
    expect(updates[0].plan).toBe("starter");
  });

  it("only 1 opts in — any other value is off", async () => {
    // "true", "yes", "on" must not enable it. A near-miss here is a real org
    // upgraded by a fake payment, so the check is exact rather than truthy.
    for (const v of ["true", "yes", "on", "0", ""]) {
      updates = [];
      process.env.LEMONSQUEEZY_ALLOW_TEST_MODE = v;
      vi.resetModules();
      const { handleWebhook } = await import("@/lib/enterprise/billing");
      const { raw, sig } = signed(subscriptionEvent({ testMode: true }));
      await handleWebhook(raw, sig);
      expect(updates, `LEMONSQUEEZY_ALLOW_TEST_MODE="${v}" must not process test events`).toEqual([]);
    }
  });
});

describe("live webhooks still work", () => {
  it("upgrade the org named in custom_data", async () => {
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const { raw, sig } = signed(subscriptionEvent({ testMode: false }));

    const res = await handleWebhook(raw, sig);
    expect(res.ok).toBe(true);
    expect(updates.length).toBe(1);
    expect(updates[0].plan).toBe("starter");
  });

  it("are rejected when the signature does not match the body", async () => {
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const { raw } = signed(subscriptionEvent({ testMode: false }));
    const res = await handleWebhook(raw, "deadbeef");
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("are rejected when the body is altered after signing", async () => {
    // The whole point of the HMAC: swapping the variant for a more expensive
    // plan must invalidate it.
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const evt = subscriptionEvent({ testMode: false });
    const { sig } = signed(evt);
    evt.data.attributes.variant_id = 1846102; // Pro
    const res = await handleWebhook(JSON.stringify(evt), sig);
    expect(res.ok).toBe(false);
    expect(updates).toEqual([]);
  });

  it("never grant a plan for an unrecognised variant", async () => {
    const { handleWebhook } = await import("@/lib/enterprise/billing");
    const evt = subscriptionEvent({ testMode: false });
    evt.data.attributes.variant_id = 424242;
    const { raw, sig } = signed(evt);

    await handleWebhook(raw, sig);
    // It may still record subscription ids, but must not set a paid plan.
    for (const u of updates) expect(u.plan).toBeUndefined();
  });
});
