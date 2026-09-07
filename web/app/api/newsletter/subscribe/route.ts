import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { signingKey, signUnsubscribe } from "@/lib/unsubscribeToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const rl = await rateLimit(`newsletter:${clientIp(req)}`, 3, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  let email: string;
  let segment = "general";
  try {
    const body = await req.json();
    email = body.email;
    if (body.segment && ["developer", "compliance", "executive", "general"].includes(body.segment)) {
      segment = body.segment;
    }
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required." }, { status: 422 });
  }
  const addr = email.toLowerCase().trim();

  // Per-EMAIL bucket, not just per-IP. The IP limit above caps how fast one
  // client can submit; it does nothing to stop the same address being signed up
  // repeatedly from different addresses, so a third party could be mailed on
  // demand. /api/leads already pairs an IP bucket with a 1/day email bucket and
  // /api/auth/magic uses dual fail-closed buckets — subscribe was the outlier.
  const perEmail = await rateLimit(`newsletter-email:${addr}`, 1, 86_400_000);
  if (!perEmail.ok) {
    // Deliberately the same success shape as a real subscribe: telling a
    // stranger "this address already tried today" would make the endpoint an
    // address-existence oracle.
    return NextResponse.json({ ok: true });
  }

  // The shared client carries no generated row types, so the upsert payload
  // infers as `never`. Same escape hatch as lib/auth.ts:29.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  const { error } = await sb
    .from("newsletter_subscribers")
    .upsert(
      { email: addr, subscribed_at: new Date().toISOString(), segment },
      { onConflict: "email", ignoreDuplicates: false }
    );

  if (error) {
    console.error("[newsletter] upsert error", error);
    return NextResponse.json({ error: "Failed to subscribe." }, { status: 500 });
  }

  // Someone who has unsubscribed must not be mailed again by re-submitting
  // their address. The upsert above intentionally does not clear the flag —
  // re-subscribing is a deliberate act through the unsubscribe page, not a
  // side effect of a form anyone can fill in on their behalf.
  const { data: existing } = await sb
    .from("newsletter_subscribers")
    .select("unsubscribed")
    .eq("email", addr)
    .maybeSingle();
  if (existing?.unsubscribed) return NextResponse.json({ ok: true });

  // A signed, one-click unsubscribe link — the same mechanism /api/cron/newsletter
  // already uses, and which this route was missing entirely. Its only opt-out was
  // the sentence "reply with 'unsubscribe'", which is not a mechanism: nothing
  // parses that reply. PECR/ePrivacy and CAN-SPAM both expect a working link, and
  // mailbox providers expect the List-Unsubscribe header.
  const BASE_URL = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") || "https://runback.dev";
  const unsubSecret = signingKey();
  const unsubUrl = unsubSecret
    ? `${BASE_URL}/api/newsletter/unsubscribe?email=${encodeURIComponent(addr)}&sig=${signUnsubscribe(addr, unsubSecret)}`
    : null;

  // Send confirmation via Resend
  const key = process.env.RESEND_API_KEY;
  if (key) {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        from: process.env.LEAD_NOTIFY_FROM || "Runback <onboarding@resend.dev>",
        to: email,
        subject: "You're subscribed to AI Governance Weekly",
        html: `<div style="font:15px/1.6 system-ui,-apple-system,sans-serif;color:#1a1a1a;max-width:520px"><h2 style="font-size:18px;margin:0 0 8px">AI Governance Weekly — confirmed.</h2><p style="margin:0 0 14px;color:#444">Each week: one regulatory development, one production incident pattern, and one concrete control teams are actually using. No filler.</p><p style="margin:0;color:#888;font-size:13px">${unsubUrl ? `<a href="${unsubUrl}" style="color:#888">Unsubscribe</a> at any time.` : "Unsubscribe anytime — reply with \"unsubscribe\"."}</p></div>`,
        text: `You're subscribed to AI Governance Weekly — one regulatory update, one incident pattern, one control per week.${unsubUrl ? `\n\nUnsubscribe: ${unsubUrl}` : ""}`,
        ...(unsubUrl
          ? { headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }
          : {}),
      }),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}
