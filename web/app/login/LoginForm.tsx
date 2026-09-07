"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Every SSO failure path redirects here with ?e=… — and nothing read it, so a
 * user whose SSO was misconfigured, or whose domain has no SSO at all, arrived
 * at a login page that said nothing and simply looked broken.
 */
const SSO_ERRORS: Record<string, string> = {
  nosso: "No single sign-on is configured for that email domain. Use a magic link instead, or ask your admin to set up SSO.",
  sso: "Single sign-on did not complete. Please try again — if it keeps failing, your identity provider's configuration may need attention.",
  // Two more SSO-callback redirect codes that existed before this map did —
  // same original gap this file's own comment describes, just not yet fixed
  // for these two.
  sso_domain: "That identity provider verified your identity, but your email domain isn't authorized for this organization's SSO. Ask an admin to add it.",
  seats: "This organization has reached its seat limit. Ask an owner or admin to remove a member or upgrade the plan, then try again.",
  rate: "Too many sign-in attempts. Wait a minute and try again.",
};

export default function LoginForm({ showcaseEnabled = false }: { showcaseEnabled?: boolean }) {
  const searchParams = useSearchParams();
  const ssoError = SSO_ERRORS[searchParams.get("e") ?? ""];

  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const [demoLoading, setDemoLoading] = useState(false);

  async function enterDemo() {
    setDemoLoading(true);
    setError("");
    try {
      const res = await fetch("/api/auth/demo", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        // Same "workspace populated, start here" welcome banner a real org
        // sees after loading sample data (see app/app/Onboarding.tsx) — the
        // demo account is always pre-seeded, so it never hits that flow on
        // its own. Land visitors on the one run worth opening first instead
        // of the bare Overview dashboard.
        window.location.href = "/app/runs?welcome=1";
        return;
      }
      setError(data.error || "Could not start the demo.");
      setStatus("error");
    } catch {
      setError("Network error — try again.");
      setStatus("error");
    } finally {
      setDemoLoading(false);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      // Enterprise SSO: if this email's domain is federated, go to the IdP.
      const sso = await fetch(`/api/auth/sso/check?email=${encodeURIComponent(email)}`).then((r) => r.json()).catch(() => ({ sso: false }));
      if (sso.sso) {
        window.location.href = `/api/auth/sso/start?email=${encodeURIComponent(email)}`;
        return;
      }
      const res = await fetch("/api/auth/magic", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.ok) setStatus("sent");
      else {
        setError(data.error || "Something went wrong.");
        setStatus("error");
      }
    } catch {
      setError("Network error — try again.");
      setStatus("error");
    }
  }

  if (status === "sent") {
    return (
      <div>
        <div className="gs-reveal-h mono">✓ Check your inbox</div>
        <p style={{ margin: "0.8rem 0 0", color: "var(--text-secondary)", fontSize: "0.92rem" }}>
          We sent a sign-in link to <span className="mono">{email}</span>. It expires in 30 minutes.
        </p>
      </div>
    );
  }

  return (
    <>
      <form className="gs-form" onSubmit={submit}>
        <label className="gs-field">
          <span>Work email</span>
          <input type="email" required autoComplete="email" placeholder="you@yourcompany.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {/* A redirect-borne SSO error, shown until the user's own action replaces it. */}
        {ssoError && status === "idle" && <p className="gs-error">{ssoError}</p>}
        {status === "error" && <p className="gs-error">{error}</p>}
        <button className="btn-fill gs-submit" type="submit" disabled={status === "loading"}>
          {status === "loading" ? "…" : "Email me a sign-in link →"}
        </button>
        <p className="gs-fine mono">Passwordless. We email you a one-time link — no password to manage.</p>
      </form>

      {showcaseEnabled && (
        <p className="auth-secondary">
          Just looking?{" "}
          <button type="button" className="link-btn" onClick={enterDemo} disabled={demoLoading}>
            {demoLoading ? "Loading the demo…" : "Explore the live demo — no sign-up"}
          </button>
        </p>
      )}
    </>
  );
}
