"use client";
import { UPGRADE_HREF } from "@/lib/edition";

import { useState } from "react";

export default function ConfirmButton({ token }: { token: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState("");

  async function go() {
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const data = await res.json();
      if (data.ok) {
        const pendingPlan = sessionStorage.getItem("runback:pending-plan");
        sessionStorage.removeItem("runback:pending-plan");
        // Signed in for real (into their own workspace), but the specific
        // team they were invited to had no seats left when they clicked —
        // send them to Team, where the seat-limit banner explains it, rather
        // than a plain /app that gives no indication the invite didn't land.
        window.location.href = data.seatLimitReached
          ? "/app/team?seat_limit=1"
          : pendingPlan ? `${UPGRADE_HREF}?plan=${pendingPlan}` : "/app";
      } else {
        setError(data.error === "expired" ? "This link has expired or was already used. Request a new one." : "Couldn't sign you in. Request a new link.");
        setStatus("error");
      }
    } catch {
      setError("Network error — try again.");
      setStatus("error");
    }
  }

  return (
    <div>
      <button className="btn-fill" onClick={go} disabled={status === "loading"} style={{ fontSize: "1rem", padding: "0.7rem 1.6rem" }}>
        {status === "loading" ? "Signing in…" : "Continue to Runback →"}
      </button>
      {status === "error" && (
        <p className="gs-error" style={{ marginTop: "1rem" }}>
          {error} <a href="/login" style={{ color: "var(--brand)" }}>Back to sign in</a>
        </p>
      )}
    </div>
  );
}
