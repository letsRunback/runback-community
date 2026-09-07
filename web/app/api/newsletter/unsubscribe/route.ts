import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustWrite } from "@/lib/supabase/write";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { verifyUnsubscribe, verifyKeys } from "@/lib/unsubscribeToken";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  // Rate limit per IP to prevent bulk automated unsubscribes
  const rl = await rateLimit(`unsub:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = req.nextUrl.searchParams.get("email");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!raw) return NextResponse.redirect(new URL("/", req.url));
  const email = decodeURIComponent(raw);

  // Always require a valid HMAC signature. Hard-fail if no signing key is configured
  // to prevent unauthenticated bulk-unsubscribe of arbitrary email addresses.
  if (!verifyKeys().length) {
    console.error("[newsletter/unsubscribe] no UNSUBSCRIBE_SECRET or AUDIT_SIGNING_KEY — refusing unsigned request");
    return NextResponse.json({ error: "Unsubscribe service misconfigured" }, { status: 503 });
  }
  // Accepts links signed with EITHER key, so mail sent before UNSUBSCRIBE_SECRET
  // existed (signed with the AUDIT_SIGNING_KEY fallback) keeps working. An
  // unsubscribe link that stops verifying is an opt-out you failed to honour.
  if (!sig || !verifyUnsubscribe(email, sig)) {
    return NextResponse.redirect(new URL("/?unsubscribe_error=1", req.url));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  // A failed write must not render as "you're unsubscribed".
  try {
    await mustWrite(
      sb.from("newsletter_subscribers").update({ unsubscribed: true }).eq("email", email),
      "newsletter unsubscribe"
    );
  } catch {
    return NextResponse.json(
      { error: "Could not record your unsubscribe. Please email support@runback.dev and we will remove you." },
      { status: 500 }
    );
  }

  return NextResponse.redirect(new URL("/?unsubscribed=1", req.url));
}
