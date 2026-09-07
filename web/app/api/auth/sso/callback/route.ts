import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { cookies } from "next/headers";
import { ssoOrgById, verifyCallback } from "@/lib/sso";
import { ensureUser, attachMembership, createSession, revokeUserSessions } from "@/lib/auth";
import { orgHasFeature } from "@/lib/planGate";
import { ensureDemoSeedForUser } from "@/lib/seedDemo";
import { rateLimit, clientIp } from "@/lib/rateLimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const origin = new URL(req.url).origin;

  // This endpoint mints sessions, and each call costs an IdP token exchange.
  // The state/nonce cookies stop CSRF but place no bound on attempt volume, so
  // without this a caller can grind code/state guesses and burn IdP quota for
  // free. Generous enough that a real user retrying a slow login never sees it.
  const rl = await rateLimit(`sso-callback:${clientIp(req)}`, 20, 60_000);
  if (!rl.ok) {
    return NextResponse.redirect(`${origin}/login?e=rate`);
  }

  const sp = new URL(req.url).searchParams;
  const code = sp.get("code");
  const state = sp.get("state");

  const jar = await cookies();
  const expState = jar.get("__Host-sso_state")?.value;
  const nonce = jar.get("__Host-sso_nonce")?.value; // undefined if missing — don't collapse to "" which could bypass nonce check
  const orgId = jar.get("__Host-sso_org")?.value;
  jar.delete("__Host-sso_state"); jar.delete("__Host-sso_nonce"); jar.delete("__Host-sso_org");

  // Constant-time comparison prevents timing oracle on CSRF state token.
  const stateMatch = expState && state &&
    expState.length === state.length &&
    crypto.timingSafeEqual(Buffer.from(expState), Buffer.from(state));
  if (!code || !stateMatch || !orgId || nonce === undefined) {
    return NextResponse.redirect(`${origin}/login?e=sso`);
  }
  const org = await ssoOrgById(orgId).catch(() => null);
  if (!org) return NextResponse.redirect(`${origin}/login?e=sso`);

  // Re-verify the org still has SSO entitlement at callback time (subscription may have lapsed).
  if (!await orgHasFeature(org.id, "sso")) {
    console.error(`[sso] org ${org.id} no longer has SSO entitlement — refusing callback`);
    return NextResponse.redirect(`${origin}/login?e=sso`);
  }

  const result = await verifyCallback(org, code, `${origin}/api/auth/sso/callback`, nonce).catch(() => null);
  if (!result) return NextResponse.redirect(`${origin}/login?e=sso`);

  // Bind the verified identity to the org's allowed domains: the IdP may authenticate
  // guests / B2B / external identities, but only emails in the org's configured
  // sso_domains may provision into it. Without this, any token the org's IdP issues
  // would grant access regardless of email domain (cross-tenant account injection).
  const emailDomain = result.email.split("@")[1] || "";
  if (!org.sso_domains.map((d) => d.toLowerCase()).includes(emailDomain.toLowerCase())) {
    console.error(`[sso] email domain "${emailDomain}" not in org ${org.id} sso_domains — refusing`);
    return NextResponse.redirect(`${origin}/login?e=sso_domain`);
  }

  // Provision: ensure the user, attach to the SSO org with the default role.
  const userId = await ensureUser(result.email, result.name);
  const attached = await attachMembership(org.id, userId, org.sso_default_role);
  if (!attached) {
    // Seat limit reached — do not create a session for an org the user was
    // just refused a seat in. An existing member always gets `true` back
    // (see attachMembership's doc comment), so this only ever turns away a
    // genuinely new provisioning attempt.
    console.warn(`[sso] new member provisioning for org ${org.id} refused — seat limit reached.`);
    return NextResponse.redirect(`${origin}/login?e=seats`);
  }
  // Rotate: invalidate any prior sessions before issuing a new one (session fixation prevention).
  await revokeUserSessions(userId);
  await createSession(userId, org.id);
  // Standard demo accounts land on a fully-populated workspace — no-op otherwise.
  await ensureDemoSeedForUser(userId, org.id);
  return NextResponse.redirect(`${origin}/app`);
}
