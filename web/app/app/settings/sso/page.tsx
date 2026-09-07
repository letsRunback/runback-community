import Link from "next/link";
import { headers } from "next/headers";
import { requireSession, atLeast } from "@/lib/auth";
import { can } from "@/lib/entitlements";
import { getSsoConfig } from "@/lib/sso";
import { planBadgeText } from "@/lib/plans";
import SsoForm from "./SsoForm";
import GateOverlay from "../../GateOverlay";

export const dynamic = "force-dynamic";

export default async function SsoSettings() {
  const session = await requireSession();
  const entitled = can(session.orgPlan, "sso");
  const canManage = atLeast(session.role, "admin");

  // Not entitled: no real SSO config exists for this org, so the empty/default
  // form state itself is the real glimpse — no need for fake data.
  const cfg = entitled
    ? (await getSsoConfig(session.orgId)) || { enabled: false, issuer: "", clientId: "", hasSecret: false, domains: [], defaultRole: "member" as const }
    : { enabled: false, issuer: "", clientId: "", hasSecret: false, domains: [], defaultRole: "member" as const };
  // Must match the origin the real flow uses: app/api/auth/sso/start/route.ts
  // and .../callback/route.ts both derive redirectUri from
  // `new URL(req.url).origin` — i.e. whatever scheme the request actually
  // arrived over. This page used to hardcode `https://`, so on any
  // deployment actually served over plain HTTP (e.g. a local self-host at
  // http://localhost:3000, or behind an internal reverse proxy) the URI
  // shown here for the admin to paste into their IdP had the wrong scheme —
  // OIDC requires an exact redirect_uri match, so that mismatch would make
  // every real SSO login fail. NEXT_PUBLIC_APP_URL is the deployment's
  // documented, self-host-correct public URL (same convention as
  // lib/auth.ts, lib/email.ts, lib/billing.ts); x-forwarded-proto (set by a
  // TLS-terminating proxy) is the fallback, then the request's own scheme.
  const h = await headers();
  const host = h.get("host") || "runback.dev";
  const proto = h.get("x-forwarded-proto") || "https";
  const origin = process.env.NEXT_PUBLIC_APP_URL || `${proto}://${host}`;
  const redirectUri = `${origin}/api/auth/sso/callback`;

  const body = (
    <>
      <div className="appc-card sso-info-card">
        <div className="appc-kv"><span>Redirect URI (add to your IdP)</span><strong className="mono sso-redirect-uri">{redirectUri}</strong></div>
        <div className="appc-kv"><span>Status</span><strong className="mono">{cfg.enabled ? "enabled" : "off"}</strong></div>
      </div>

      {canManage ? <SsoForm initial={cfg} /> : <p className="empty">Ask an admin to configure SSO.</p>}
    </>
  );

  return (
    <div className="appc">
      <Link href="/app/settings" className="apprun-back mono">← Settings</Link>
      <div className="appc-head">
        <h1 className="appc-h1">Single sign-on</h1>
        <p className="appc-sub">Federate sign-in with your identity provider (OIDC).</p>
      </div>

      {!entitled ? (
        <GateOverlay
          badge={planBadgeText("sso")}
          title="SSO is an Enterprise feature"
          lead="Federate sign-in with your IdP — Okta, Azure AD / Entra, Google Workspace, Auth0, Ping. OIDC, domain-routed, with just-in-time provisioning. Available on Enterprise."
          ctaHref="/contact?plan=enterprise"
          ctaLabel="Talk to sales →"
        >
          {body}
        </GateOverlay>
      ) : body}

      {!entitled && (
        <p className="empty sso-upsell-note">Self-hosting? Enterprise features need a signed license in <span className="mono">RUNBACK_LICENSE</span> — <a href="/contact" className="sso-link-blue">request one</a>.</p>
      )}
    </div>
  );
}
