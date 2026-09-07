import { NextRequest, NextResponse } from "next/server";
import { ensureUserAndOrg, createSession } from "@/lib/auth";
import { SHOWCASE, isDemoEmail } from "@/lib/demoMode";
import { ensureDemoSeedForUser } from "@/lib/seedDemo";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/**
 * One-click demo login. Standard demo accounts (RUNBACK_DEMO_EMAILS) have no real
 * mailbox, so a magic link can never reach them — this signs them in directly.
 * Safe to expose publicly: it ONLY ever signs in an allowlisted demo account, and
 * those accounts are fully simulated (zero provider calls, zero spend) and auto-
 * seeded with sample data. It can never log anyone into a real workspace.
 */
// `||` not `??` — see lib/demoMode.ts: compose passes this as an empty string
// when unset, which `??` treats as a real value.
const DEFAULT_DEMO_EMAIL = (process.env.RUNBACK_DEMO_EMAILS || "demo@runback.dev")
  .split(",")[0]
  .trim()
  .toLowerCase();

export async function POST(req: NextRequest) {
  // Gated on SHOWCASE, not DEMO_MODE: the hosted site needs a working "try the
  // demo" button while real customers get real replay. A self-host that has set
  // neither flag still gets 404, since SHOWCASE defaults to DEMO_MODE.
  if (!SHOWCASE) {
    return NextResponse.json({ ok: false, error: "Not found." }, { status: 404 });
  }

  const rl = await rateLimit(`demo-login:${clientIp(req)}`, 12, 60_000);
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts — give it a moment." },
      { status: 429, headers: { "retry-after": String(rl.retryAfter) } }
    );
  }

  // Optional explicit email (must still be allowlisted); default to the primary.
  let email = DEFAULT_DEMO_EMAIL;
  try {
    const body = await req.json();
    if (body?.email) email = String(body.email).trim().toLowerCase();
  } catch {
    /* no body — use the default demo account */
  }

  if (!isDemoEmail(email)) {
    return NextResponse.json({ ok: false, error: "Not a demo account." }, { status: 403 });
  }

  const { userId, orgId } = await ensureUserAndOrg(email, "Demo");
  await createSession(userId, orgId);
  // Populate the workspace so every page is alive on arrival.
  await ensureDemoSeedForUser(userId, orgId);

  return NextResponse.json({ ok: true });
}
