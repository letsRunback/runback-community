import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { ssoOrgForEmail } from "@/lib/sso";
import { authorizeUrl } from "@/lib/sso";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

/** Kick off SSO for an email's domain: set state/nonce, redirect to the IdP. */
export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  // Unauthenticated and it answers a question about arbitrary input: given an
  // email, does this domain have SSO configured? The redirect target differs
  // (?e=nosso vs the IdP), so an unmetered caller can enumerate which companies
  // are customers, one domain at a time, for free. Rate limiting is what turns
  // that from a bulk oracle into a nuisance.
  const rl = await rateLimit(`sso-start:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.redirect(`${origin}/login?e=rate`);
  }

  const email = new URL(req.url).searchParams.get("email") || "";
  const org = await ssoOrgForEmail(email).catch(() => null);
  if (!org) return NextResponse.redirect(`${origin}/login?e=nosso`);

  const state = crypto.randomBytes(16).toString("hex");
  const nonce = crypto.randomBytes(16).toString("hex");
  const redirectUri = `${origin}/api/auth/sso/callback`;
  const url = await authorizeUrl(org, redirectUri, state, nonce).catch(() => null);
  if (!url) return NextResponse.redirect(`${origin}/login?e=sso`);

  const jar = await cookies();
  // __Host- requires Secure + Path=/ + no Domain (all satisfied here).
  // It also prevents subdomain injection: a cookie from sub.example.com cannot
  // be sent to example.com's SSO callback, unlike __Secure- which allows it.
  const opts = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
  jar.set("__Host-sso_state", state, opts);
  jar.set("__Host-sso_nonce", nonce, opts);
  jar.set("__Host-sso_org", org.id, opts);
  return NextResponse.redirect(url);
}
