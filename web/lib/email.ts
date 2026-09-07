import { signingKey, signUnsubscribe } from "@/lib/unsubscribeToken";

/**
 * Transactional email via Resend (https://resend.com) — NOT corporate AWS SES.
 *
 * Two messages fire on every captured lead, automatically and immediately:
 *   1. sendLeadWelcome      → the signer gets the full setup details at once.
 *   2. sendLeadNotification → the operator gets the lead.
 *
 * Plain HTTP API (no SDK). Fully env-gated — if the key isn't set it logs and
 * no-ops, so lead capture never breaks and the site is safe to ship before email
 * is configured. The moment RESEND_API_KEY lands in the env, both emails send.
 *
 * Required env (set on Vercel once the Resend account + verified domain exist):
 *   RESEND_API_KEY    — from resend.com
 *   LEAD_NOTIFY_TO    — where operator lead alerts land (your inbox). PRIVATE —
 *                       never put this in customer-facing copy; use SUPPORT_EMAIL
 *                       below for the address shown to recipients.
 *   LEAD_NOTIFY_FROM  — a verified sender, e.g. "Runback <hello@runback.dev>"
 *                       (verify runback.dev in Resend to send to any recipient)
 *   SUPPORT_EMAIL     — PUBLIC. The "questions? write us at ___" address shown
 *                       inside outbound customer emails. Defaults to
 *                       hello@runback.dev. Keep this distinct from
 *                       LEAD_NOTIFY_TO — that one is commonly a personal inbox
 *                       during early operation, and reusing it here shipped an
 *                       operator's personal address to every subscriber.
 */
const RESEND_ENDPOINT = "https://api.resend.com/emails";

export interface LeadNotice {
  email: string;
  domain: string;
  company?: string | null;
  useCase?: string | null;
  source?: string;
}

function fromAddress(): string {
  return process.env.LEAD_NOTIFY_FROM || "Runback <onboarding@resend.dev>";
}

/** The public "questions? write us" address shown inside outbound customer
 *  email — deliberately NOT LEAD_NOTIFY_TO, which is the operator's private
 *  inbox for lead alerts and must never appear in copy a recipient sees. */
function supportAddress(): string {
  return process.env.SUPPORT_EMAIL || "hello@runback.dev";
}

/**
 * Deliver through an operator's own SMTP relay.
 *
 * `RUNBACK_SMTP_URL` is a standard connection URL and carries everything
 * needed, so there is one variable rather than the usual six:
 *
 *   smtp://relay.internal:25                 (no auth, common inside a network)
 *   smtp://user:pass@relay.internal:587      (STARTTLS — nodemailer upgrades)
 *   smtps://user:pass@relay.internal:465     (implicit TLS)
 *
 * Imported dynamically so nodemailer is never pulled into a deployment that
 * does not use it, and so a broken install degrades to "email is unavailable"
 * rather than taking down every route that happens to import this module.
 *
 * Returns false and logs on any failure, exactly like the Resend path — no
 * caller of send() should have to know which transport ran.
 */
async function sendViaSmtp(
  url: string,
  msg: { to: string; subject: string; html: string; text: string; replyTo?: string }
): Promise<boolean> {
  try {
    const nodemailer = (await import("nodemailer")).default;
    const transporter = nodemailer.createTransport(url);
    await transporter.sendMail({
      from: fromAddress(),
      to: msg.to,
      replyTo: msg.replyTo,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
    return true;
  } catch (e) {
    // Deliberately does not echo the URL: it commonly embeds a password.
    console.error("[email] smtp send failed:", (e as Error).message);
    return false;
  }
}

/** Low-level send. Returns false (and logs) if unconfigured or on error; never throws. */
async function send(msg: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
}): Promise<boolean> {
  // SMTP first. An air-gapped or on-prem deployment cannot reach Resend's REST
  // API at all, and every such site already has an internal relay — Exchange,
  // Postfix, a corporate smarthost. Setting RUNBACK_SMTP_URL is an unambiguous
  // statement that mail goes through it, so it wins over any Resend key that
  // happens to be lying around in the same environment.
  const smtpUrl = process.env.RUNBACK_SMTP_URL;
  if (smtpUrl) return sendViaSmtp(smtpUrl, msg);

  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.log("[email] no RUNBACK_SMTP_URL or RESEND_API_KEY set — skipping send to", msg.to);
    return false;
  }
  try {
    const res = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: fromAddress(),
        to: [msg.to],
        reply_to: msg.replyTo,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      console.error("[email] resend failed:", res.status, (await res.text().catch(() => "")).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error("[email] resend threw:", e);
    return false;
  }
}

/** A short welcome. The actual setup commands are shown on screen at signup. */
export async function sendLeadWelcome(lead: LeadNotice): Promise<boolean> {
  const support = supportAddress();
  const text =
    `Welcome to Runback — deploy AI agents you can prove are safe.\n\n` +
    `Your setup commands are on the screen where you signed up (your API key + a one-line quickstart, or self-host). ` +
    `Run them and your first agent run shows up at https://runback.dev/runs.\n\n` +
    `Verify the engine yourself — the determinism proof is public:\n` +
    `https://github.com/letsRunback/runback-proofs\n\n` +
    `Questions, or want it managed? Just reply, or write ${support}.`;
  const html =
    `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:560px">` +
    `<h2 style="font-size:18px;margin:0 0 6px">Welcome to Runback</h2>` +
    `<p style="margin:0 0 14px;color:#555">Deploy AI agents you can prove are safe.</p>` +
    `<p style="margin:0 0 14px">Your setup commands are on the screen where you signed up — your API key plus a one-line quickstart (or the self-host command). Run them and your first agent run appears at <a href="https://runback.dev/runs" style="color:#2563eb">runback.dev/runs</a>.</p>` +
    `<p style="margin:14px 0 4px"><a href="https://github.com/letsRunback/runback-proofs" style="color:#2563eb">Verify the engine yourself — the determinism proof is public →</a></p>` +
    `<p style="margin:18px 0 0;color:#888;font-size:13px">Questions, or want it managed? Just reply, or write ${support}.</p>` +
    `</div>`;
  return send({ to: lead.email, subject: "Welcome to Runback", html, text, replyTo: support });
}

/** The operator gets the lead. */
export async function sendLeadNotification(lead: LeadNotice): Promise<boolean> {
  const to = process.env.LEAD_NOTIFY_TO;
  if (!to) {
    console.log("[email] LEAD_NOTIFY_TO not set — skipping operator notification");
    return false;
  }
  const rows = [
    ["Email", lead.email],
    ["Company", lead.company || "—"],
    ["Domain", lead.domain],
    ["Use case", lead.useCase || "—"],
    ["Source", lead.source || "get-started"],
  ];
  const text = rows.map(([k, v]) => `${k}: ${v}`).join("\n");
  const html =
    `<h2 style="margin:0 0 12px;font:600 16px system-ui">New Runback lead</h2>` +
    `<table style="font:14px system-ui;border-collapse:collapse">` +
    rows
      .map(
        ([k, v]) =>
          `<tr><td style="padding:4px 16px 4px 0;color:#666">${k}</td><td style="padding:4px 0"><strong>${escapeHtml(
            String(v)
          )}</strong></td></tr>`
      )
      .join("") +
    `</table>`;
  return send({
    to,
    // sanitizeHeader strips CR/LF/TAB that could fold or inject SMTP headers.
    subject: sanitizeHeader(`New Runback lead — ${lead.company || lead.domain}`),
    html,
    text,
    replyTo: sanitizeHeader(lead.email),
  });
}

/** Send a magic sign-in link. */
export async function sendMagicLink(email: string, link: string, isInvite = false): Promise<boolean> {
  const verb = isInvite ? "join your team on Runback" : "sign in to Runback";
  const text = `Click to ${verb}:\n${link}\n\nThis link expires in 30 minutes. If you didn't request it, ignore this email.`;
  const html =
    `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:520px">` +
    `<h2 style="font-size:18px;margin:0 0 10px">${isInvite ? "You're invited to Runback" : "Sign in to Runback"}</h2>` +
    `<p style="margin:0 0 18px;color:#555">Click the button to ${verb}.</p>` +
    `<p style="margin:0 0 18px"><a href="${link}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${isInvite ? "Join the team" : "Sign in"}</a></p>` +
    `<p style="margin:0;color:#888;font-size:13px">This link expires in 30 minutes. If you didn't request it, ignore this email.</p>` +
    `</div>`;
  return send({ to: email, subject: isInvite ? "Join your team on Runback" : "Your Runback sign-in link", html, text });
}

/** Generic alert email. */
export async function sendAlertEmail(to: string, subject: string, lines: string[]): Promise<boolean> {
  const text = lines.join("\n");
  const html =
    `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:560px">` +
    `<h2 style="font-size:17px;margin:0 0 10px">${escapeHtml(subject)}</h2>` +
    lines.map((l) => `<p style="margin:0 0 6px;color:#444">${escapeHtml(l)}</p>`).join("") +
    `</div>`;
  return send({ to, subject: `[Runback] ${subject}`, html, text });
}

/** Generate a signed one-click unsubscribe URL for PLG marketing emails (EU ePrivacy / UK PECR). */
function plgUnsubscribeUrl(email: string): string | null {
  // Signs with the newest key; the route verifies against every accepted key, so
  // links already sitting in inboxes keep working across a rotation. Scoping to
  // "plg" keeps newsletter and PLG tokens from being cross-used.
  const key = signingKey();
  if (!key) return null;
  const sig = signUnsubscribe(email, key, "plg");
  const base = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  return `${base}/api/user/plg-unsubscribe?email=${encodeURIComponent(email)}&sig=${sig}`;
}

/** PLG lifecycle nurture emails — one per event type. */
export async function sendPlgNurture(
  to: string,
  event: string,
  _meta: Record<string, unknown>
): Promise<boolean> {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  type Msg = { subject: string; heading: string; body: string; cta: string; ctaUrl: string };
  const msgs: Record<string, Msg> = {
    first_run_captured: {
      subject: "Your first agent run is live",
      heading: "Your first run landed.",
      body: "Runback captured it. Head to your dashboard to see the full trace — every LLM call, tool use, and token count.",
      cta: "View your run →",
      ctaUrl: `${appUrl}/app/runs`,
    },
    first_error_caught: {
      subject: "Runback caught an agent error",
      heading: "An agent error was captured.",
      body: "Runback logged the full trace. You can time-travel replay it to pinpoint where it went wrong — no reproduction needed.",
      cta: "Replay the error →",
      ctaUrl: `${appUrl}/app/runs`,
    },
    first_policy_created: {
      subject: "Your first policy is enforcing",
      heading: "Policy is live.",
      body: "Every future run is now checked against it. Next: add the Runback CI gate so a failing policy blocks a deploy automatically.",
      cta: "Add to CI →",
      ctaUrl: `${appUrl}/docs#feat-cigate`,
    },
    first_eval_run: {
      subject: "Eval complete — add it to your pipeline",
      heading: "Your eval finished.",
      body: "Add the release gate to your CI config and this eval runs on every push. A failing policy blocks the deploy before it ships.",
      cta: "See CI setup →",
      ctaUrl: `${appUrl}/docs#feat-cigate`,
    },
    trial_nudge_day3: {
      subject: "One thing that'll save you at 3am",
      heading: "You've captured runs — now write a policy.",
      body: "A policy tells Runback what counts as a bad run. When an agent breaks at 3am you'll get an alert with a full replay, not a blank log.",
      cta: "Write your first policy →",
      ctaUrl: `${appUrl}/app/policies`,
    },
    trial_nudge_day5: {
      subject: "The release gate — one YAML line",
      heading: "Block bad deploys automatically.",
      body: "Add the Runback CI gate to your pipeline and a failing policy stops the deploy before it reaches production. One line of config.",
      cta: "Add the CI gate →",
      ctaUrl: `${appUrl}/docs#feat-cigate`,
    },
    trial_nudge_day7: {
      subject: "Your Runback trial — what happens next",
      heading: "Your trial wraps up soon.",
      body: "You keep your run history and replay access on the free tier. Policies and the CI gate require Starter or above. Any questions — just reply.",
      cta: "See plans →",
      ctaUrl: `${appUrl}/pricing`,
    },
    first_team_member_invited: {
      subject: "Team access is live",
      heading: "Your team can now see the runs.",
      body: "You've added a team member. When the next incident lands, they'll have the same replay access you do — no log-grepping, no war room.",
      cta: "View the team dashboard →",
      ctaUrl: `${appUrl}/app/cost/teams`,
    },
    milestone_100_runs: {
      subject: "100 runs captured",
      heading: "You've captured 100 agent runs.",
      body: "That's enough history to run a policy simulation — see what a policy would have caught over the last 30 days before you enforce it live.",
      cta: "Simulate a policy →",
      ctaUrl: `${appUrl}/app/policies`,
    },
    week3_no_upgrade: {
      subject: "Getting what you need from Runback?",
      heading: "Three weeks in — anything blocking you?",
      body: "You've been on the free tier for three weeks. Happy to walk through what's included in Growth or answer any questions about the CI gate, policy enforcement, or self-hosted Enterprise. Just reply.",
      cta: "See what's in Growth →",
      ctaUrl: `${appUrl}/pricing`,
    },
  };
  const m = msgs[event];
  if (!m) return false;
  const support = supportAddress();
  const unsubUrl = plgUnsubscribeUrl(to);
  const unsubText = unsubUrl ? `\n\nTo stop these emails: ${unsubUrl}` : "";
  const unsubHtml = unsubUrl
    ? `<p style="margin:12px 0 0;color:#aaa;font-size:12px">You're receiving this because you signed up for Runback. <a href="${unsubUrl}" style="color:#aaa">Unsubscribe</a>.</p>`
    : "";
  const text = `${m.heading}\n\n${m.body}\n\n${m.cta}\n${m.ctaUrl}\n\nQuestions? Just reply or write ${support}.${unsubText}`;
  const html =
    `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:560px">` +
    `<h2 style="font-size:18px;margin:0 0 8px">${escapeHtml(m.heading)}</h2>` +
    `<p style="margin:0 0 18px;color:#444">${escapeHtml(m.body)}</p>` +
    `<p style="margin:0 0 18px"><a href="${m.ctaUrl}" style="background:#2563eb;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">${escapeHtml(m.cta)}</a></p>` +
    `<p style="margin:0;color:#888;font-size:13px">Questions? Just reply or write ${escapeHtml(support)}.</p>` +
    unsubHtml +
    `</div>`;
  return send({ to, subject: m.subject, html, text, replyTo: support });
}

/** Notify org admins that a new approval is waiting for review. */
export async function sendApprovalNotification(
  orgId: string,
  approval: { id: string; run_id: string; rule_desc?: string | null; context: Record<string, unknown> }
): Promise<void> {
  // Lazy import to avoid circular deps — approvals lib is not imported at module level.
  const { orgAdminEmails } = await import("@/lib/approvals");
  const admins = await orgAdminEmails(orgId).catch(() => [] as string[]);
  if (!admins.length) return;

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://runback.dev";
  const url = `${appUrl}/app/approvals`;
  const tool = (approval.context.tool_name as string | undefined) ?? "agent action";
  const run  = (approval.context.run_name  as string | undefined) ?? approval.run_id;
  const rule = approval.rule_desc ?? "A policy rule requires human review.";

  const subject = `Action required — ${tool} is waiting for approval`;
  const text =
    `An agent decision needs your review before it can proceed.\n\n` +
    `Run: ${run}\nAction: ${tool}\nRule: ${rule}\n\n` +
    `Review it: ${url}`;
  const html =
    `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:540px">` +
    `<h2 style="font-size:17px;margin:0 0 4px">Action required</h2>` +
    `<p style="margin:0 0 16px;color:#555">An agent decision is waiting for your review.</p>` +
    `<table style="font:13px system-ui;border-collapse:collapse;margin-bottom:18px">` +
    `<tr><td style="padding:3px 16px 3px 0;color:#888">Run</td><td><strong>${escapeHtml(run)}</strong></td></tr>` +
    `<tr><td style="padding:3px 16px 3px 0;color:#888">Action</td><td><strong>${escapeHtml(tool)}</strong></td></tr>` +
    `<tr><td style="padding:3px 16px 3px 0;color:#888">Rule</td><td>${escapeHtml(rule)}</td></tr>` +
    `</table>` +
    `<a href="${url}" style="background:#111;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block;font-size:14px">Review &amp; decide →</a>` +
    `</div>`;

  await Promise.all(admins.map((to) => send({ to, subject, html, text })));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

/** Strip characters that are unsafe in SMTP/email header values.
 *  CR, LF, and NUL can break header parsing at the relay layer even when
 *  sending via REST (Resend encodes to SMTP internally). Tabs are also stripped
 *  to prevent folded-header injection. Length-capped to reject oversized inputs. */
function sanitizeHeader(s: string, maxLen = 200): string {
  return s.replace(/[\r\n\t\0]/g, " ").slice(0, maxLen).trim();
}
