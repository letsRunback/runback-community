"use client";

import { useState } from "react";

export default function ExecUnlockForm() {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/exec-unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (data.ok) {
        const next = new URLSearchParams(window.location.search).get("next") || "/exec.html";
        window.location.href = next.startsWith("/") ? next : "/exec.html";
        return;
      }
      setErr(data.error || "Wrong password.");
    } catch {
      setErr("Network error — try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      style={{
        width: "100%",
        maxWidth: 380,
        border: "1px solid var(--border-subtle)",
        borderRadius: 16,
        background: "var(--bg-surface)",
        padding: "1.8rem 1.6rem",
        display: "flex",
        flexDirection: "column",
        gap: "0.9rem",
      }}
    >
      <span className="mono" style={{ fontSize: "0.72rem", letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--brand-2)" }}>
        Private · confidential
      </span>
      <h1 style={{ fontSize: "1.3rem", letterSpacing: "-0.02em", margin: 0 }}>
        Runback executive briefing
      </h1>
      <p style={{ fontSize: "0.88rem", color: "var(--text-secondary)", margin: 0, lineHeight: 1.5 }}>
        This deck is private. Enter the password you were given to view it.
      </p>
      <input
        type="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        style={{
          background: "var(--bg-base)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          padding: "0.7rem 0.85rem",
          color: "var(--text-primary)",
          fontSize: "0.95rem",
        }}
      />
      {err && <p style={{ color: "var(--rose)", fontSize: "0.85rem", margin: 0 }}>{err}</p>}
      <button type="submit" className="btn-fill" disabled={loading} style={{ justifyContent: "center" }}>
        {loading ? "Checking…" : "View the briefing →"}
      </button>
    </form>
  );
}
