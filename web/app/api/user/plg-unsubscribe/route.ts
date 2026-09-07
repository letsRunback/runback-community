/**
 * One-click PLG marketing email unsubscribe (EU ePrivacy Directive / UK PECR).
 * The link is included in every PLG nurture email with a signed token so it works
 * without requiring the user to be logged in.
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { mustWrite } from "@/lib/supabase/write";
import { rateLimit, clientIp } from "@/lib/rateLimit";
import { verifyUnsubscribe, verifyKeys } from "@/lib/unsubscribeToken";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const rl = await rateLimit(`plg_unsub:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

  const raw = req.nextUrl.searchParams.get("email");
  const sig = req.nextUrl.searchParams.get("sig");
  if (!raw) return NextResponse.redirect(new URL("/", req.url));
  const email = decodeURIComponent(raw);

  if (!verifyKeys().length) {
    console.error("[plg-unsubscribe] no UNSUBSCRIBE_SECRET or AUDIT_SIGNING_KEY — refusing");
    return NextResponse.json({ error: "Unsubscribe service misconfigured" }, { status: 503 });
  }
  // Accepts either key so links mailed before UNSUBSCRIBE_SECRET existed still work.
  if (!sig || !verifyUnsubscribe(email, sig, "plg")) {
    return NextResponse.redirect(new URL("/?unsubscribe_error=1", req.url));
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;
  // Never claim "unsubscribed" over a write that did not land. While
  // users.plg_email_unsubscribed was missing this UPDATE no-opped, the user was
  // shown a success page, and the cron kept mailing them — the exact failure
  // EU ePrivacy / UK PECR exist to prevent.
  try {
    await mustWrite(
      sb.from("users").update({ plg_email_unsubscribed: true }).eq("email", email.toLowerCase()),
      "plg unsubscribe"
    );
  } catch {
    return NextResponse.json(
      { error: "Could not record your unsubscribe. Please email support@runback.dev and we will remove you." },
      { status: 500 }
    );
  }

  return NextResponse.redirect(new URL("/?plg_unsubscribed=1", req.url));
}
