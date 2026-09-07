import { NextRequest, NextResponse } from "next/server";
import { consumeMagicLink, createSession, revokeUserSessions } from "@/lib/auth";
import { ensureDemoSeedForUser } from "@/lib/seedDemo";
import { rateLimitFailClosed, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** POST consumes the token (only fires on the user's click, not an email prefetch). */
export async function POST(req: NextRequest) {
  // Rate-limit token consumption to prevent DB flooding via brute-force.
  // Tokens are already single-use and expire in 30 min; this is defense-in-depth.
  const rl = await rateLimitFailClosed(`auth-verify:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.json({ ok: false, error: "Too many requests." }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  }

  let token: string | null = null;
  try {
    token = (await req.json())?.token ?? null;
  } catch {
    token = null;
  }
  if (!token) return NextResponse.json({ ok: false, error: "missing" }, { status: 400 });

  const result = await consumeMagicLink(token);
  if (!result) return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });

  // Rotate: invalidate any prior sessions before issuing a new one.
  await revokeUserSessions(result.userId);
  await createSession(result.userId, result.orgId);
  // Standard demo accounts land on a fully-populated workspace — no-op otherwise.
  await ensureDemoSeedForUser(result.userId, result.orgId);
  // result.orgId is the user's OWN org here, not the one they were invited to
  // — see consumeMagicLink's doc comment. The session is real either way; the
  // client just needs to know the invite specifically didn't go through.
  return NextResponse.json({ ok: true, seatLimitReached: result.seatLimitReached === true });
}

/** A direct GET (e.g. an old link) just bounces to the confirm page — never consumes. */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  const origin = new URL(req.url).origin;
  return NextResponse.redirect(`${origin}/auth/confirm${token ? `?token=${token}` : ""}`);
}
