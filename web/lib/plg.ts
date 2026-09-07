/**
 * PLG (Product-Led Growth) event pipeline.
 *
 * Each event fires at most once per org — the UNIQUE(org_id, event) constraint
 * on plg_events is the deduplication layer. Call firePlgEvent freely on every
 * request; the second call is a no-op at the DB level.
 *
 * Email and Slack are both env-gated and best-effort — a misconfigured key
 * never breaks the callers.
 *
 * Required env:
 *   RESEND_API_KEY      — already used by email.ts
 *   SLACK_PLG_WEBHOOK   — incoming webhook URL for #plg-alerts Slack channel
 */

import { getAdminClient } from "@/lib/supabase/admin";

export type PlgEvent =
  | "first_run_captured"
  | "first_error_caught"
  | "first_policy_created"
  | "first_eval_run"
  | "first_team_member_invited"   // expansion signal — team is adopting
  | "milestone_100_runs"          // usage depth signal
  | "trial_nudge_day3"
  | "trial_nudge_day5"
  | "trial_nudge_day7"
  | "week3_no_upgrade";           // 21 days free — stalled, needs sales touch

// High-intent events that trigger a Slack sales alert.
const SALES_ALERTS: PlgEvent[] = [
  "first_run_captured",
  "first_error_caught",
  "first_team_member_invited",
  "milestone_100_runs",
  "trial_nudge_day7",
  "week3_no_upgrade",
];

/**
 * The shared client carries no generated row types, so query builders infer
 * `never` payloads. Same escape hatch as lib/auth.ts:29 — safety comes from the
 * explicit return types on the helpers below.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

export async function firePlgEvent(
  orgId: string,
  event: PlgEvent,
  meta: Record<string, unknown> = {}
): Promise<void> {
  const sb: SbClient = getAdminClient();

  // Insert — unique constraint means a duplicate is a silent no-op.
  const { error } = await sb.from("plg_events").insert({ org_id: orgId, event, meta });
  if (error) {
    if (error.code === "23505") return; // already fired
    console.error("[plg] insert failed:", error.message);
    return;
  }

  // First fire — resolve owner email, check opt-out, then dispatch.
  const email = await getOwnerEmail(orgId, sb);
  const unsubscribed = email ? await isPlgUnsubscribed(email, sb) : false;
  await Promise.allSettled([
    (email && !unsubscribed) ? sendPlgEmail(email, event, meta) : Promise.resolve(),
    SALES_ALERTS.includes(event) ? notifySlack(orgId, event, meta, email) : Promise.resolve(),
  ]);
}

// ─── helpers ────────────────────────────────────────────────────────────────

async function getOwnerEmail(orgId: string, sb: SbClient): Promise<string | null> {
  const { data } = await sb
    .from("memberships")
    .select("users(email)")
    .eq("org_id", orgId)
    .eq("role", "owner")
    .maybeSingle();
  return (data as { users?: { email?: string } } | null)?.users?.email ?? null;
}

async function isPlgUnsubscribed(email: string, sb: SbClient): Promise<boolean> {
  const { data } = await sb
    .from("users")
    .select("plg_email_unsubscribed")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  return !!(data as { plg_email_unsubscribed?: boolean } | null)?.plg_email_unsubscribed;
}

async function notifySlack(
  orgId: string,
  event: PlgEvent,
  meta: Record<string, unknown>,
  email: string | null
): Promise<void> {
  const url = process.env.SLACK_PLG_WEBHOOK;
  if (!url) return;
  const label: Record<PlgEvent, string> = {
    first_run_captured:           "First run captured",
    first_error_caught:           "Error caught — high intent",
    first_policy_created:         "First policy created",
    first_eval_run:               "First eval / CI gate run",
    first_team_member_invited:    "Team member invited — expansion signal 🟡",
    milestone_100_runs:           "100 runs milestone — usage depth 🟡",
    trial_nudge_day3:             "Trial day 3 — no policy yet",
    trial_nudge_day5:             "Trial day 5 — no CI gate yet",
    trial_nudge_day7:             "Trial day 7 — still on free ⚠️",
    week3_no_upgrade:             "Week 3 free — stalled, needs outreach 🔴",
  };
  // run_name is customer-supplied and may contain client/matter names — omit from
  // Slack to avoid transmitting confidential data to a third-party sub-processor
  // that is not disclosed in the DPA (GDPR Art.13 / Art.28).
  const text = `*${label[event]}*\nOrg: ${orgId}${email ? `\nUser: ${email}` : ""}${
    meta.count ? `\nCount: ${String(meta.count)}` : ""
  }`;
  await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text }),
  }).catch(() => {});
}

// ─── email dispatch ──────────────────────────────────────────────────────────

async function sendPlgEmail(
  to: string,
  event: PlgEvent,
  meta: Record<string, unknown>
): Promise<boolean> {
  const { sendPlgNurture } = await import("@/lib/email");
  return sendPlgNurture(to, event, meta);
}
