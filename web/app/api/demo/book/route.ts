import { NextRequest, NextResponse } from "next/server";
import { rateLimit, clientIp } from "@/lib/rateLimit";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`demo:${clientIp(req)}`, 3, 300_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const { name, email, role, size, use, notes } = body;
  if (!name || !email) return NextResponse.json({ error: "Name and email required." }, { status: 422 });

  const key = process.env.RESEND_API_KEY;
  const notifyTo = process.env.LEAD_NOTIFY_TO || "contact@runback.dev";
  const from = process.env.LEAD_NOTIFY_FROM || "Runback <onboarding@resend.dev>";

  if (key) {
    const html = `<div style="font:15px/1.6 system-ui,sans-serif;color:#1a1a1a;max-width:520px">
<h2 style="font-size:17px;margin:0 0 12px">Demo request — ${esc(name)}</h2>
<table style="border-collapse:collapse;width:100%">
<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Email</td><td style="padding:4px 0">${esc(email)}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Role</td><td style="padding:4px 0">${esc(role || "—")}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Size</td><td style="padding:4px 0">${esc(size || "—")}</td></tr>
<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap">Use case</td><td style="padding:4px 0">${esc(use || "—")}</td></tr>
${notes ? `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top">Notes</td><td style="padding:4px 0">${esc(notes)}</td></tr>` : ""}
</table>
<p style="margin:16px 0 0"><a href="mailto:${esc(email)}?subject=Re: Runback demo" style="background:#2563eb;color:#fff;padding:9px 16px;border-radius:7px;text-decoration:none;font-size:14px">Reply to ${esc(name)} &rarr;</a></p>
</div>`;

    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from, to: notifyTo, subject: `Demo request — ${name} · ${role || email}`, html, text: `${name} (${email}) wants a demo. Role: ${role}. Size: ${size}. Use: ${use}. Notes: ${notes}` }),
    }).catch(() => {});
  }

  // Slack notification if webhook is configured.
  const slack = process.env.SLACK_WEBHOOK_URL;
  if (slack) {
    await fetch(slack, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `🎯 *Demo request* — ${name} (${email})\n*Role:* ${role || "—"} · *Size:* ${size || "—"} · *Use:* ${use || "—"}${notes ? `\n*Notes:* ${notes}` : ""}` }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
