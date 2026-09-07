import { NextRequest, NextResponse } from "next/server";
import { ssoOrgForEmail } from "@/lib/sso";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Does this email's domain route to an SSO org? Used by /login. */
export async function GET(req: NextRequest) {
  // Rate-limit to prevent customer enumeration via domain probing.
  const rl = await rateLimit(`sso-check:${clientIp(req)}`, 10, 60_000);
  if (!rl.ok) return NextResponse.json({ error: "Too many requests." }, { status: 429 });

  const email = new URL(req.url).searchParams.get("email") || "";
  const org = await ssoOrgForEmail(email).catch(() => null);
  // Return boolean only — orgName is not needed by the login UI before auth
  // and exposing it allows unauthenticated customer enumeration by domain.
  return NextResponse.json({ sso: !!org });
}
