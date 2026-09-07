import { NextRequest, NextResponse } from "next/server";
import { signingKey, signUnsubscribe } from "@/lib/unsubscribeToken";
import { getAdminClient } from "@/lib/supabase/admin";
import { tryRead } from "@/lib/supabase/read";
import { mustWrite } from "@/lib/supabase/write";
import { euAiActState } from "@/lib/euAiAct";
import { cronAuthorized } from "@/lib/cronAuth";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * Subscribers attempted per invocation. The send is resumable, so this is a
 * throughput knob, not a ceiling on list size — whatever is not reached this run
 * is picked up by the next one. Kept well inside maxDuration at ~200ms/email.
 */
const BATCH_SIZE = 500;

/** Absolute base for unsubscribe links — they must resolve from a mail client. */
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://runback.dev";

// Regulatory facts — real citations, no writing required. Rotates by week so
// each issue covers a different framework.
const REG_FACTS = [
  () => {
    const eu = euAiActState();
    return eu.enforced
      ? "EU AI Act Article 12 is now in force. High-risk AI systems must maintain automatic event logs that are tamper-evident and enable competent authorities to verify compliance. Non-compliance triggers enforcement from national supervisory authorities."
      : `EU AI Act Article 12 requires automatic event logs for high-risk AI systems — enforceable from 2 August 2026 (${eu.badge.date}). Systems without a verifiable decision record will not meet the standard.`;
  },
  () => "NIST AI RMF Govern 1.7 requires organisations to document AI lifecycle decisions including the data, model, and context used. A log of outputs does not satisfy this — the input context must be preserved.",
  () => "APRA CPS 230 (effective 1 July 2025) requires Australian financial institutions to manage and document operational risks from technology — including AI agent failures. The record must be producible on request.",
  () => "ISO/IEC 42001 requires a documented AI management system with evidence of controls. Auditors are increasingly asking for signed artifacts, not policy statements.",
];

function weekNumber(): number {
  const d = new Date();
  const jan1 = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - jan1.getTime()) / 86400_000 + jan1.getDay() + 1) / 7);
}

interface FleetSignal {
  total_runs: number;
  top_cause: string | null;
  top_cause_count: number;
  new_templates: { name: string; description: string }[];
  new_golden: number;
}

// The shared client carries no generated row types. Same escape hatch as
// lib/auth.ts:29; safety comes from the row shapes below plus tryRead.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getAdminClient() as any;

/**
 * Weekly fleet numbers for the "Fleet signal" section.
 *
 * The policy-cause half of this was querying columns that do not exist:
 * `cause_type`, `created_at`, and a `count:id` that is not valid PostgREST
 * aggregate syntax either. ad_policy_causes is a daily rollup keyed
 * (org_id, day, policy_name, agent) with block_count / run_count. The query
 * 400'd every week, the ignored error left top_cause null, and the newsletter
 * silently shipped its generic fallback paragraph instead of real fleet data —
 * which is the one thing that section exists to provide.
 *
 * Every read here degrades rather than throws: a missing number should cost the
 * newsletter a sentence, not stop the send.
 */
async function getFleetSignal(): Promise<FleetSignal> {
  const sb = db();
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  // ad_policy_causes.day is a DATE, so it needs a date not a timestamp.
  const sinceDay = since.slice(0, 10);

  const [runsRes, causeRows, templates, goldenRes] = await Promise.all([
    sb.from("ad_runs").select("run_id", { count: "exact", head: true }).gte("started_at", since),
    tryRead<Array<{ policy_name: string; block_count: number }>>(
      sb.from("ad_policy_causes").select("policy_name, block_count").gte("day", sinceDay),
      "newsletter: load policy causes",
      []
    ),
    tryRead<Array<{ name: string; description: string }>>(
      sb
        .from("ad_policy_templates")
        .select("name, description")
        .eq("is_public", true)
        .gte("created_at", since)
        .limit(5),
      "newsletter: load new public policy templates",
      []
    ),
    sb.from("ad_golden").select("id", { count: "exact", head: true }).gte("created_at", since),
  ]);

  // Sum block_count per policy across the week and take the worst. PostgREST has
  // no portable GROUP BY here, and the row count is one per policy/agent/day —
  // small enough to fold client-side.
  const blocksByPolicy = new Map<string, number>();
  for (const r of causeRows) {
    blocksByPolicy.set(r.policy_name, (blocksByPolicy.get(r.policy_name) ?? 0) + (r.block_count ?? 0));
  }
  const [topPolicy, topCount] = [...blocksByPolicy.entries()].sort((a, b) => b[1] - a[1])[0] ?? [null, 0];

  return {
    total_runs: runsRes.count ?? 0,
    top_cause: topPolicy,
    top_cause_count: topCount,
    new_templates: templates,
    new_golden: goldenRes.count ?? 0,
  };
}

/**
 * Render a policy name for prose. These are user-authored policy names like
 * "escalate-large-disputed", not values from a fixed taxonomy — the old map of
 * cause_type constants never matched anything this table actually holds.
 */
function causeLabel(policyName: string): string {
  return policyName.replace(/[_-]+/g, " ").trim();
}

/**
 * Subscriber segments, as captured by the signup form.
 *
 * The form has always asked which of these a subscriber is, and the answer has
 * always been stored — and never once read. Collecting personal data you make no
 * use of is a data-minimisation problem as well as a wasted signal, so either
 * this had to be used or the field had to go. Each segment gets the same three
 * facts, ordered by what that reader opens the mail for.
 */
type Segment = "developer" | "compliance" | "executive" | "general";

const SEGMENTS: Segment[] = ["developer", "compliance", "executive", "general"];

function isSegment(v: string | null | undefined): v is Segment {
  return !!v && (SEGMENTS as string[]).includes(v);
}

const SEGMENT_STYLE: Record<Segment, { subject: (w: number) => string; lead: string; order: ("regulatory" | "signal" | "control")[] }> = {
  // Ships things: what broke and what to do about it comes first; the law last.
  developer: {
    subject: (w) => `Agent failure pattern of the week — #${w}`,
    lead: "One production failure pattern, one control that prevents it, and the regulation behind it — assembled from real fleet data every Monday.",
    order: ["signal", "control", "regulatory"],
  },
  // Answers to auditors: the citation leads.
  compliance: {
    subject: (w) => `AI Governance Weekly — week ${w}`,
    lead: "One cited regulatory development, one control that evidences it, and the failure pattern it exists to catch.",
    order: ["regulatory", "control", "signal"],
  },
  // Wants exposure and trend, not mechanism.
  executive: {
    subject: (w) => `AI risk this week — #${w}`,
    lead: "Where AI agent risk sits this week: the regulation in force, what is actually going wrong across the fleet, and the control that closes it.",
    order: ["regulatory", "signal", "control"],
  },
  general: {
    subject: (w) => `AI Governance Weekly — week ${w}`,
    lead: "From real fleet data and cited law — assembled automatically every Monday.",
    order: ["regulatory", "signal", "control"],
  },
};

function buildEmail(
  week: number,
  signal: FleetSignal,
  segment: Segment = "general"
): { subject: string; html: string; text: string } {
  const regFact = REG_FACTS[week % REG_FACTS.length]();

  let incidentPara: string;
  if (signal.total_runs > 0 && signal.top_cause) {
    incidentPara = `This week ${signal.total_runs.toLocaleString()} agent runs were captured across the fleet. The most common policy signal: <strong>${causeLabel(signal.top_cause)}</strong>${signal.top_cause_count > 1 ? ` (${signal.top_cause_count} occurrences)` : ""}. Pattern: an agent takes an action outside its defined scope — a refund above the limit, a tool call that should have triggered escalation. Replay isolates the exact context the model saw.`;
  } else if (signal.total_runs > 0) {
    incidentPara = `${signal.total_runs.toLocaleString()} agent runs captured this week. No policy violations flagged — all runs completed within defined constraints.`;
  } else {
    incidentPara = "The most common AI agent failure pattern: an action taken outside the agent's defined policy scope. The model completes the task it was given — but the task itself exceeded what the policy permits. Replay from the captured context shows the exact input that produced the decision.";
  }

  let controlPara: string;
  if (signal.new_templates.length > 0) {
    const names = signal.new_templates.map((t) => t.name).join(", ");
    controlPara = `${signal.new_templates.length} new ${signal.new_templates.length === 1 ? "template" : "templates"} added to the policy library this week: ${names}. Apply a template, simulate it against 90 days of decisions, then enforce it live — without writing policy logic from scratch.`;
  } else if (signal.new_golden > 0) {
    controlPara = `${signal.new_golden} new ${signal.new_golden === 1 ? "case" : "cases"} enrolled in the golden test corpus this week. Each is a real production failure that now blocks the same class of failure from reaching production again. The corpus writes itself from reality.`;
  } else {
    controlPara = "Simulate a policy against 90 days of production decisions before you ship it. You see exactly which past runs would have been blocked — real decisions, not synthetic test cases. Ship only when the simulation matches your intent.";
  }

  const style = SEGMENT_STYLE[segment];

  const SECTIONS = {
    regulatory: { title: "Regulatory", colour: "#4f9cf9", body: regFact },
    signal:     { title: "Fleet signal", colour: "#7c5cfc", body: incidentPara },
    control:    { title: "Control", colour: "#10b981", body: controlPara },
  } as const;

  const ordered = style.order.map((k) => SECTIONS[k]);

  const sectionsHtml = ordered
    .map(
      (s) =>
        `<h3 style="font-size:14px;color:${s.colour};margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em">${s.title}</h3>\n<p style="margin:0 0 20px">${s.body}</p>`
    )
    .join("\n");

  const html = `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:560px">
<p style="color:#6b7280;font-size:13px;margin:0 0 20px;font-family:monospace">AI GOVERNANCE WEEKLY · WEEK ${week}</p>
<h2 style="font-size:20px;margin:0 0 6px;letter-spacing:-0.02em">One law. One signal. One control.</h2>
<p style="margin:0 0 24px;color:#444;font-size:14px">${style.lead}</p>
<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">
${sectionsHtml}
<hr style="border:none;border-top:1px solid #e5e7eb;margin:0 0 20px">
<p style="margin:0 0 8px"><a href="${BASE_URL}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-size:14px">Open Runback →</a></p>
<p style="margin:12px 0 0;color:#9ca3af;font-size:12px">You subscribed at runback.dev. <a href="{{unsubUrl}}" style="color:#9ca3af">Unsubscribe</a>.</p>
</div>`;

  const sectionsText = ordered
    .map((s) => `${s.title.toUpperCase()}\n${s.body.replace(/<[^>]+>/g, "")}`)
    .join("\n\n");

  const text = `AI GOVERNANCE WEEKLY · WEEK ${week}\n\n${sectionsText}\n\nrunback.dev\n\nUnsubscribe: {{unsubUrl}}`;

  return { subject: style.subject(week), html, text };
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const key = process.env.RESEND_API_KEY;
  if (!key) return NextResponse.json({ sent: 0, reason: "no RESEND_API_KEY" });

  const sb = db();
  const week = weekNumber();
  // The issue key, not just the week number: week 3 of 2026 and week 3 of 2027
  // must not collide, or a subscriber is skipped a year later.
  const issue = `${new Date().getUTCFullYear()}-W${String(week).padStart(2, "0")}`;

  // Only those who have not already had THIS issue. That single filter provides
  // both the resume cursor (a timed-out run continues where it stopped) and
  // idempotency (a re-run sends nothing).
  const subscribers = await tryRead<Array<{ email: string; segment: string | null }>>(
    sb
      .from("newsletter_subscribers")
      .select("email,segment")
      .eq("unsubscribed", false)
      .or(`last_sent_week.is.null,last_sent_week.neq.${issue}`)
      .limit(BATCH_SIZE),
    "newsletter: load pending subscribers",
    []
  );

  if (!subscribers.length) {
    return NextResponse.json({ sent: 0, issue, reason: "everyone already received this issue" });
  }

  const signal = await getFleetSignal();
  // Render once per segment, not once per subscriber — four templates, however
  // long the list is.
  const bySegment = new Map(SEGMENTS.map((s) => [s, buildEmail(week, signal, s)]));
  const from = process.env.LEAD_NOTIFY_FROM || "Runback <onboarding@resend.dev>";

  const unsubSecret = signingKey();
  if (!unsubSecret) {
    // An unsigned unsubscribe link lets anyone unsubscribe anyone by editing the
    // URL, and the receiving route rejects unsigned links anyway — so sending
    // would produce mail whose unsubscribe link cannot work. PECR/ePrivacy make
    // a working opt-out mandatory; refuse to send rather than break it.
    console.error("[newsletter] no UNSUBSCRIBE_SECRET or AUDIT_SIGNING_KEY — refusing to send unsubscribable mail");
    return NextResponse.json(
      { sent: 0, error: "No signing key configured for unsubscribe links." },
      { status: 503 }
    );
  }

  // Stop before the platform kills the function mid-flight: a hard timeout would
  // drop the batch's progress marker and re-send to everyone next run.
  const deadline = Date.now() + (maxDuration - 10) * 1000;

  let sent = 0;
  let failed = 0;
  const delivered: string[] = [];

  for (const { email, segment } of subscribers) {
    if (Date.now() > deadline) break;

    const { subject, html, text } = bySegment.get(isSegment(segment) ? segment : "general")!;

    // Per-subscriber signed unsubscribe URL (PECR / ePrivacy requirement).
    const sig = signUnsubscribe(email, unsubSecret);
    const unsubUrl =
      `${BASE_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;

    const emailHtml = html.replace(/\{\{unsubUrl\}\}/g, unsubUrl);
    const emailText = text.replace(/\{\{unsubUrl\}\}/g, unsubUrl);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from, to: email, subject, html: emailHtml, text: emailText,
        // The signed link was already in the body, but not in the header
        // mailbox providers actually read to offer one-click unsubscribe.
        headers: {
          "List-Unsubscribe": `<${unsubUrl}>`,
          "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        },
      }),
    }).catch(() => null);

    if (res?.ok) {
      sent++;
      delivered.push(email);
    } else {
      // Do NOT mark a failed send as delivered — leaving the cursor untouched is
      // what lets the next run retry it. Log it so a persistent failure is
      // visible instead of being absorbed into a smaller `sent` count.
      failed++;
      console.error(
        `[newsletter] send to ${email} failed:`,
        res ? `HTTP ${res.status} ${await res.text().catch(() => "")}` : "network error"
      );
    }
    await new Promise((r) => setTimeout(r, 60));
  }

  // Stamp the whole delivered batch at once — one round trip, and a crash before
  // this point simply means those recipients are retried (at-least-once), which
  // is the right failure direction for a newsletter.
  if (delivered.length) {
    await mustWrite(
      sb.from("newsletter_subscribers").update({ last_sent_week: issue }).in("email", delivered),
      "newsletter: stamp delivered batch"
    );
  }

  const remaining = subscribers.length - sent - failed;
  return NextResponse.json({ sent, failed, remaining_in_batch: remaining, issue, week, signal });
}
