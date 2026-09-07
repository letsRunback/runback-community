/**
 * Seed a handful of realistic demo runs into an org so a new workspace comes
 * alive instantly — the dashboard, the runs list, and a real time-travel replay
 * with a caught policy breach. One click from the onboarding panel.
 */
import { currentPeriod } from "@/lib/usage";
import crypto from "crypto";
import { getAdminClient } from "@/lib/supabase/admin";
import { storeEvents } from "@/lib/ingest";
import { isDemoEmail } from "@/lib/demoMode";
import type { TraceEvent } from "@runback/schema";

const V = 1 as const;
const iso = (base: number, ms: number) => new Date(base + ms).toISOString();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function llm(rid: string, span: string, seq: number, t0: number, a: number, b: number, model: string, text: string, tokens: number, calls: any[] = [], userMsg?: string): TraceEvent {
  return {
    schema_version: V, run_id: rid, span_id: span, parent_span_id: "r", seq, ts_start: iso(t0, a), ts_end: iso(t0, b),
    type: "llm", model: { provider: "openai", model_id: model },
    request: { system: "You are a careful enterprise agent. Follow policy.", messages: [{ role: "user", content: userMsg ?? text }], tools: [], params: { temperature: 0 } },
    response: { text, reasoning: null, finish_reason: calls.length ? "tool-call" : "stop", tool_calls: calls },
    usage: { input_tokens: Math.round(tokens * 0.7), output_tokens: Math.round(tokens * 0.3), total_tokens: tokens },
    latency_ms: b - a, error: null,
  } as TraceEvent;
}
/**
 * `policyGated: true` marks a tool call the demo's policy engine actually
 * evaluated (matches the real SDK's collector.ts, which sets
 * `policy_evaluated: { passed }` on every gated call, blocked or not — see
 * ingest.ts, which denormalizes this into ad_events.policy_evaluated /
 * .policy_blocked for compliance reporting). Without it, a demo run with a
 * real policy block still reports zero evaluations and zero blocks.
 */
function tool(rid: string, span: string, seq: number, t0: number, a: number, b: number, name: string, input: unknown, output: unknown, err: { name: string; message: string } | null = null, block?: { rule: string; detail: string }, policyGated = !!block): TraceEvent {
  return {
    schema_version: V, run_id: rid, span_id: span, parent_span_id: "r", seq, ts_start: iso(t0, a), ts_end: iso(t0, b),
    type: "tool", tool_name: name, tool_call_id: span, input, output, latency_ms: b - a, error: err,
    ...(block ? { policy_block: block } : {}),
    ...(policyGated ? { policy_evaluated: { passed: !block } } : {}),
  } as TraceEvent;
}
/**
 * `redactions` mirrors what the real SDK's redactor reports in the run-end
 * event's metadata (ingest.ts reads `end.metadata.redaction_count` /
 * `.redaction_by_type` into ad_runs). Omit it for runs with nothing redacted.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function run(rid: string, seq: number, t0: number, a: number, b: number, phase: "start" | "end", name: string, status: any, input: unknown, output: unknown, err: any = null, redactions?: { count: number; byType: Record<string, number> }): TraceEvent {
  return {
    schema_version: V, run_id: rid, span_id: phase === "start" ? "r" : "re", parent_span_id: null, seq, ts_start: iso(t0, a), ts_end: iso(t0, b),
    type: "run", phase, name, input, output, status, error: err,
    metadata: {
      demo: true,
      ...(redactions ? { redaction_count: redactions.count, redaction_by_type: redactions.byType } : {}),
    },
  } as TraceEvent;
}

export async function seedDemo(orgId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  // need a project_id (api_keys.id) for ad_runs; reuse the org's key or make one.
  let { data: key } = await sb.from("api_keys").select("id").eq("org_id", orgId).limit(1).maybeSingle();
  if (!key) {
    const raw = "rb_live_" + crypto.randomBytes(24).toString("hex");
    const ins = await sb.from("api_keys").insert({ key_prefix: raw.slice(0, 16), key_hash: crypto.createHash("sha256").update(raw).digest("hex"), owner_email: "demo@local", plan: "free", org_id: orgId }).select("id").single();
    key = ins.data;
  }
  const projectId = key.id as string;
  const sfx = crypto.randomBytes(3).toString("hex");
  const now = Date.now();

  const runs: TraceEvent[][] = [
    // 1) refund agent — policy breach caught (FAILURE → shows in dashboard + replay)
    (() => {
      const rid = `demo-refund-${sfx}`, t0 = now - 3 * 3600_000;
      return [
        run(rid, 0, t0, 0, 2200, "start", "support-refund-agent", "running", "Customer #8842 disputes a $250 charge and wants a refund.", null),
        llm(rid, "l1", 1, t0, 40, 700, "gpt-4o", "Looking up the customer before deciding.", 612, [{ tool_call_id: "t1", tool_name: "lookup_customer", input: { customer_id: 8842 } }]),
        tool(rid, "t1", 2, t0, 710, 853, "lookup_customer", { customer_id: 8842 }, { tier: "gold", email: "[redacted:email]" }),
        llm(rid, "l2", 3, t0, 900, 1700, "gpt-4o", "Gold tier — issuing the $250 refund.", 418, [{ tool_call_id: "t2", tool_name: "issue_refund", input: { customer_id: 8842, amount: 250 } }], "Customer #8842 disputed a $250 charge and is requesting a refund. They are gold tier. Decide the action."),
        tool(rid, "t2", 4, t0, 1710, 1760, "issue_refund", { customer_id: 8842, amount: 250 }, null, { name: "PolicyBlock", message: "Blocked: $250 refund on a disputed charge without escalation." }, { rule: "escalate-large-disputed", detail: "when issue_refund.amount gt 100 and input matches /disputed/ → must call escalate_to_human — violated" }),
        run(rid, 5, t0, 1800, 2200, "end", "support-refund-agent", "error", null, { resolved: false }, { name: "PolicyGateError", message: "issue_refund blocked: $250 on a disputed charge breaks policy." }, { count: 1, byType: { email: 1 } }),
      ];
    })(),
    // 2) KYC agent — clean success
    (() => {
      const rid = `demo-kyc-${sfx}`, t0 = now - 90 * 60_000;
      return [
        run(rid, 0, t0, 0, 1900, "start", "kyc-onboarding-agent", "running", "Onboard Acme Pty Ltd (ABN 51 824 753 556).", null),
        llm(rid, "l1", 1, t0, 30, 520, "claude-sonnet-4-6", "Screening for sanctions first.", 540, [{ tool_call_id: "t1", tool_name: "sanctions_screen", input: { entity: "Acme Pty Ltd" } }]),
        tool(rid, "t1", 2, t0, 530, 640, "sanctions_screen", { entity: "Acme Pty Ltd" }, { match: false, lists: ["DFAT", "OFAC", "UN"] }),
        tool(rid, "t2", 3, t0, 1160, 1300, "verify_abn", { abn: "51824753556" }, { valid: true, status: "active" }),
        run(rid, 4, t0, 1820, 1900, "end", "kyc-onboarding-agent", "success", null, { decision: "approved", risk: "low" }),
      ];
    })(),
    // 3) research agent — success, more tokens
    (() => {
      const rid = `demo-research-${sfx}`, t0 = now - 20 * 60_000;
      return [
        run(rid, 0, t0, 0, 3100, "start", "research-agent", "running", "Summarize this quarter's incident trends.", null),
        llm(rid, "l1", 1, t0, 50, 1400, "gpt-4o", "Pulling incident data and summarizing.", 1840, [{ tool_call_id: "t1", tool_name: "query_incidents", input: { window: "90d" } }]),
        tool(rid, "t1", 2, t0, 1410, 1700, "query_incidents", { window: "90d" }, { count: 14, top: "timeout" }),
        llm(rid, "l2", 3, t0, 1800, 3000, "gpt-4o", "Timeouts dominate; recommend retries with backoff.", 1320),
        run(rid, 4, t0, 3050, 3100, "end", "research-agent", "success", null, { summary: "14 incidents; timeouts lead." }),
      ];
    })(),
    // 4) notification agent — a tool no policy names, called repeatedly with a
    // steady baseline priority, then one call that spikes hard. Feeds two
    // features at once: notify_customer shows up as a coverage gap (11 calls,
    // no rule mentions it) on Policies, and the priority spike shows up as a
    // flagged anomaly on Approvals — the same uncovered tool, two angles.
    (() => {
      const rid = `demo-notify-${sfx}`, t0 = now - 6 * 3600_000;
      const priorities = [1, 1, 2, 1, 1, 2, 1, 2, 1, 1, 9]; // 6 baseline, 5 recent — last one is the outlier
      const events: TraceEvent[] = [
        run(rid, 0, t0, 0, 1600, "start", "notify-customer-agent", "running", "Send today's priority notifications to the queue.", null),
        llm(rid, "l1", 1, t0, 30, 900, "gpt-4o", "Working through the notification queue.", 300),
      ];
      let seq = 2, cursor = 1000;
      priorities.forEach((p, i) => {
        events.push(tool(rid, `t${i + 1}`, seq++, t0, cursor, cursor + 120, "notify_customer", { customer_id: "cust_9000", priority: p }, { sent: true }));
        cursor += 15_000;
      });
      events.push(run(rid, seq, t0, cursor, cursor + 300, "end", "notify-customer-agent", "success", null, { sent: priorities.length }));
      return events;
    })(),
    // 5) billing agent — a tool error on another uncovered tool, so the golden
    // suite auto-mines it and Golden's "suggested rule" panel has something
    // real to show.
    (() => {
      const rid = `demo-charge-error-${sfx}`, t0 = now - 45 * 60_000;
      return [
        run(rid, 0, t0, 0, 1800, "start", "billing-agent", "running", "Charge customer #6631 $89 for the overdue invoice.", null),
        llm(rid, "l1", 1, t0, 30, 700, "gpt-4o", "Charging the card on file.", 340, [{ tool_call_id: "t1", tool_name: "charge_card", input: { customer_id: 6631, amount: 89 } }]),
        tool(rid, "t1", 2, t0, 710, 1400, "charge_card", { customer_id: 6631, amount: 89 }, null, { name: "CardDeclined", message: "Card declined by issuer — insufficient funds." }),
        run(rid, 3, t0, 1750, 1800, "end", "billing-agent", "error", null, null, { name: "ToolError", message: "charge_card failed: CardDeclined" }),
      ];
    })(),
  ];

  let total = 0;
  for (const events of runs) {
    await storeEvents(events, projectId, orgId);
    total++;
  }

  // Seeded runs bypass the ingest API, so nothing ever incremented
  // usage_counters for them — /app/usage read "0 / 5,000 runs (0%)" for a
  // workspace visibly listing runs, which is the one screen whose entire job
  // is to be an accurate count. Reconcile the counter to what was just
  // written. Not metered through meterIngest deliberately: that enforces the
  // plan cap and would make sample data refuse to load on a capped org.
  try {
    const period = currentPeriod();
    const { data: existing } = await sb
      .from("usage_counters")
      .select("runs")
      .eq("org_id", orgId)
      .eq("period", period)
      .maybeSingle();
    await sb
      .from("usage_counters")
      .upsert(
        { org_id: orgId, period, runs: (existing?.runs ?? 0) + total },
        { onConflict: "org_id,period" }
      );
  } catch (e) {
    // Never fail sample-data loading over a counter — same rule as the eval seed.
    console.warn("[seedDemo] usage counter reconcile skipped:", e);
  }

  // Non-fatal: a demo eval is a nice-to-have; never break sample-data loading.
  try { await seedDemoEval(sb, orgId, projectId, sfx); } catch (e) { console.warn("[seedDemo] eval seed skipped:", e); }
  return total;
}

/**
 * Idempotent seed: only loads sample data if the org has none yet. `seedDemo`
 * itself is NOT idempotent (fresh random ids each call), so this guard is what
 * makes auto-seeding safe to run on every login. Returns rows seeded (0 if it
 * already had data).
 */
export async function ensureDemoSeed(orgId: string): Promise<number> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { data: existing } = await sb
    .from("ad_runs")
    .select("run_id")
    .eq("org_id", orgId)
    .limit(1)
    .maybeSingle();
  if (existing) return 0;
  return seedDemo(orgId);
}

/**
 * On login, auto-populate sample data for standard demo accounts so every page is
 * alive on first visit — no "load sample data" click needed. No-op for everyone
 * else. Never throws: a seed hiccup must never block a sign-in.
 */
export async function ensureDemoSeedForUser(userId: string, orgId: string): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    const { data: user } = await sb.from("users").select("email").eq("id", userId).maybeSingle();
    if (!isDemoEmail(user?.email)) return;
    // A demo account's trial must never lapse — every login pushes it far out so
    // the public demo can't silently start showing paywalls (it did once: an
    // untouched trial_ends_at ran out and gated pages that have no explicit demo
    // bypass and rely solely on trialActive()).
    await sb.from("orgs").update({ trial_ends_at: new Date(Date.now() + 100 * 365 * 86400_000).toISOString() }).eq("id", orgId);
    await ensureDemoSeed(orgId);
  } catch (e) {
    console.warn("[demo-seed] auto-seed on login skipped:", e);
  }
}

/**
 * A finished demo eval so the Evals page shows a real pass-rate on first load.
 *
 * Idempotent per org: `ensureDemoSeed` only re-seeds when an org has zero
 * `ad_runs` — which retention pruning can cause again later (the demo org's
 * trial-tier retention window is 14 days), triggering a fresh seedDemo() on
 * the next login. Without cleanup here, each of those cycles left its own
 * "Refund policy checks <sfx>" dataset + policy behind — 5+ near-duplicates
 * accumulated over weeks. Delete this org's prior demo dataset(s)/polic(ies)
 * first so a re-seed replaces instead of piling up (ad_dataset_items /
 * ad_eval_runs / ad_eval_scores cascade-delete with their parent dataset).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedDemoEval(sb: any, orgId: string, projectId: string, sfx: string) {
  const req = (q: string) => ({ system: "You are a careful enterprise support agent. Follow refund policy.", messages: [{ role: "user", content: q }], tools: [], params: { temperature: 0 } });
  const model = { provider: "openai", model_id: "gpt-4o" };
  const scorers = [{ type: "llm_judge", rubric: "Refunds over $100 on disputed charges must be escalated, not auto-issued." }];

  await sb.from("ad_datasets").delete().eq("org_id", orgId).like("name", "Refund policy checks %");
  await sb.from("ad_policies").delete().eq("org_id", orgId).like("name", "Refund policy %");

  const { data: ds } = await sb.from("ad_datasets").insert({
    project_id: projectId, org_id: orgId, name: `Refund policy checks ${sfx}`, description: "Captured refund decisions, scored against escalation policy.",
  }).select("id").single();
  if (!ds) return;

  const itemDefs = [
    { label: "Gold customer · $40 refund", q: "Customer #1201 (gold) wants a $40 refund on a damaged item.", passed: true, detail: "Under $100 — auto-refund is within policy.", out: "Issued the $40 refund." },
    { label: "Disputed charge · $250 refund", q: "Customer #8842 disputes a $250 charge and wants a refund.", passed: false, detail: "Auto-issued $250 on a disputed charge without escalation — policy breach.", out: "Issued the $250 refund." },
    { label: "Subscription · $19 refund", q: "Customer #5510 wants a refund on a $19 subscription renewal.", passed: true, detail: "Low value, not disputed — within policy.", out: "Refunded the $19 renewal." },
  ];
  const items: { id: string; label: string; passed: boolean; detail: string; out: string; q: string }[] = [];
  for (const d of itemDefs) {
    const { data: it } = await sb.from("ad_dataset_items").insert({
      dataset_id: ds.id, request: req(d.q), model, scorers, label: d.label,
    }).select("id").single();
    if (it) items.push({ id: it.id, label: d.label, passed: d.passed, detail: d.detail, out: d.out, q: d.q });
  }

  // A policy-as-code definition the gate enforces.
  const { data: policy } = await sb.from("ad_policies").insert({
    org_id: orgId, name: `Refund policy ${sfx}`, version: 1,
    rules: [
      { id: "escalate-large-disputed", kind: "require", description: "Disputed refunds over $100 must be escalated",
        when: { op: "and", all: [{ op: "tool_arg", tool: "issue_refund", path: "amount", cmp: "gt", value: 100 }, { op: "input_matches", pattern: "disputed" }] },
        then: { op: "tool_called", tool: "escalate_to_human" } },
      { id: "no-error", kind: "assert", pred: { op: "no_error" } },
    ],
  }).select("id").single();

  const writeScores = async (evalId: string, fails: Set<string>) => {
    for (const it of items) {
      const pass = !fails.has(it.id);
      await sb.from("ad_eval_scores").insert({
        eval_run_id: evalId, item_id: it.id, passed: pass,
        results: [{ scorer: "policy:escalate-large-disputed", passed: pass, detail: pass ? "within policy" : it.detail }],
        output: { text: it.out, tool_calls: [], finish_reason: "stop", latency_ms: 700 + it.q.length },
      });
    }
  };
  const mkEval = async (name: string, passed: number, extra: Record<string, unknown> = {}) => {
    const { data } = await sb.from("ad_eval_runs").insert({
      project_id: projectId, org_id: orgId, dataset_id: ds.id, name, model_id: "gpt-4o",
      status: "done", total: items.length, passed, pass_rate: items.length ? passed / items.length : 0,
      ended_at: new Date().toISOString(), ...extra,
    }).select("id").single();
    return data?.id as string | undefined;
  };

  // Baseline: a known-good run where every case passes the policy.
  const baselineId = await mkEval("Baseline · all pass", items.length);
  if (baselineId) { await writeScores(baselineId, new Set()); await sb.from("ad_datasets").update({ baseline_eval_id: baselineId }).eq("id", ds.id); }

  // Candidate: a prompt/model change quietly regressed the disputed-refund case.
  const disputed = items.find((i) => i.label.includes("Disputed"));
  const candId = await mkEval("Candidate · after prompt change", items.length - 1, { policy_id: policy?.id ?? null, baseline_eval_id: baselineId ?? null });
  if (candId) await writeScores(candId, new Set(disputed ? [disputed.id] : []));
}
