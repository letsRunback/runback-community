"use client";

import { useState } from "react";

export default function ProCheckout({
  className = "btn-line price-cta",
  label = "Start Pro →",
  plan = "pro",
}: {
  className?: string;
  label?: string;
  plan?: "starter" | "growth" | "scale" | "pro";
}) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });

      if (res.status === 403) {
        alert("Only an org admin can manage billing. Ask your admin to upgrade.");
        return;
      }

      // Checkout now requires a signed-in org (anonymous checkout used to create
      // subscriptions no one could ever link back to an org — see the security
      // fix that closed that hole). A visitor on the public pricing page has no
      // session yet, so send them to create one and resume on /app/upgrade
      // instead of silently rerouting a "start my paid plan" click into the
      // sales contact form.
      if (res.status === 401) {
        sessionStorage.setItem("runback:pending-plan", plan);
        window.location.href = "/login";
        return;
      }

      const data = await res.json().catch(() => ({})) as { ok?: boolean; url?: string; error?: string };

      if (data.ok && data.url) {
        window.location.href = data.url;
        return;
      }

      window.location.href = `/contact?plan=${plan}`;
    } catch {
      window.location.href = `/contact?plan=${plan}`;
    } finally {
      setLoading(false);
    }
  }

  return (
    <button type="button" className={className} onClick={go} disabled={loading}>
      {loading ? "Starting…" : label}
    </button>
  );
}
