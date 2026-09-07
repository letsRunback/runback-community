"use client";
import { useState } from "react";
import Link from "next/link";
import Header from "@/components/site/Header";
import Footer from "@/components/site/Footer";


const ROLES = ["CTO / VP Engineering", "CISO / Security", "Compliance / Risk", "Engineering Manager", "Staff / Senior Engineer", "VC / Investor", "Other"];
const SIZES = ["1–10", "11–50", "51–250", "251–1000", "1000+"];
const USES = ["Reproduce production agent failures", "CI gate before model/prompt deploys", "Compliance audit trail", "Policy enforcement at runtime", "General AI governance", "Evaluating / investor diligence"];

const WOW = [
  {
    tone: "rose",
    metric: "4m 23s",
    vs: "vs 3h 48m without",
    title: "Root cause — guaranteed",
    body: "Every failed run opens on the failure step. Click it to see the exact messages[] array the model was given — not 2,400 log lines, the context. Root cause in minutes.",
    cta: "Walk the scenario →",
    href: "/how-it-works",
  },
  {
    tone: "violet",
    metric: "1 click",
    vs: "replay on any model",
    title: "Replay it differently",
    body: "Re-run any step from the exact captured context against a different model. Same inputs, different output? You found the regression. Gate every upgrade in CI before it ships.",
    cta: "How replay works →",
    href: "/how-it-works",
  },
  {
    tone: "emerald",
    metric: "Signed",
    vs: "SHA-256 hash-chained",
    title: "Audit record — instant",
    body: "Every decision sealed in a tamper-evident cassette. Download and verify independently — no Runback account needed. Meets EU AI Act Art. 12, APRA CPS 230, NIST AI RMF.",
    cta: "Compliance details →",
    href: "/enterprise",
  },
];

export default function Demo() {
  const [form, setForm] = useState({ name: "", email: "", role: "", size: "", use: "", notes: "" });
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("sending");
    const res = await fetch("/api/demo/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(form),
    }).catch(() => null);
    setStatus(res?.ok ? "done" : "error");
  }

  if (status === "done") {
    return (
      <>
        <Header />
        <main className="mk" style={{ paddingTop: "4rem", paddingBottom: "4rem", minHeight: "60vh" }}>
          <span className="mk-eyebrow">Confirmed</span>
          <h1 style={{ fontSize: "clamp(1.8rem,3.5vw,2.6rem)", letterSpacing: "-0.04em", margin: "1rem 0 0.6rem" }}>
            We&apos;ll be in touch within one business day.
          </h1>
          <p style={{ color: "var(--text-secondary)", maxWidth: "52ch" }}>
            Check your inbox — we&apos;ll send a calendar invite with a Zoom or Google Meet link.
            Most sessions run 30 minutes.
          </p>
          <div style={{ marginTop: "2rem", display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
            <Link href="/how-it-works" className="btn-fill">Walk the MTTR scenario while you wait →</Link>
            <Link href="/get-started" className="btn-line">Or start free right now</Link>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return (
    <>
      <Header />
      <main>

        {/* ── WOW preview ── */}
        <section className="mk demo-preview-section">
          <span className="mk-eyebrow">What you&apos;ll see in 30 minutes</span>
          <h1 className="demo-preview-h1">
            Your agents — observable, replayable, provable.
          </h1>
          <p className="mk-lead" style={{ maxWidth: "58ch" }}>
            We&apos;ll connect to a real agent run in your environment, find root cause in minutes,
            replay it on a different model, and seal a signed audit record — live. No slides.
          </p>

          <div className="demo-wow-grid">
            {WOW.map((w) => (
              <div key={w.title} className="demo-wow-card" data-tone={w.tone}>
                <div className="demo-wow-metric">
                  <span className="demo-wow-num mono">{w.metric}</span>
                  <span className="demo-wow-vs">{w.vs}</span>
                </div>
                <h3 className="demo-wow-title">{w.title}</h3>
                <p className="demo-wow-body">{w.body}</p>
                <Link href={w.href} className="demo-wow-link mono">{w.cta}</Link>
              </div>
            ))}
          </div>
          <p className="mono" style={{ fontSize: "0.72rem", color: "var(--text-muted)", marginTop: "0.6rem" }}>
            4m 23s / 3h 48m is an illustrative worked example, based on common production patterns — walk it yourself at <Link href="/how-it-works#incident" className="mk-link">/how-it-works</Link>.
          </p>

          <div className="demo-try-live">
            {/* This pointed at /how-it-works, a marketing page with no
                interactive scenario on it. The live sandbox is the demo
                workspace — which is the thing the label was promising. */}
            <Link href="/login" className="btn-line">
              Explore the live workspace — no sign-up →
            </Link>
            <span className="demo-try-or">or</span>
            <Link href="/get-started" className="btn-line">
              Start free — no card required →
            </Link>
          </div>
        </section>

        {/* ── Divider ── */}
        <div className="mk demo-form-divider">
          <span>Book a live session in your environment</span>
        </div>

        {/* ── Booking form ── */}
        <section className="mk" style={{ paddingTop: "2rem", paddingBottom: "4rem" }}>
          <p className="mk-lead" style={{ maxWidth: "56ch", marginBottom: "1.75rem" }}>
            30 minutes. We&apos;ll walk through capture, replay, and the CI gate against a real
            agent run. Tell us what you&apos;re trying to solve.
          </p>

          <form onSubmit={submit} style={{ maxWidth: 560, display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div className="gs-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Name</label>
                <input className="form-input" required placeholder="Your name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </div>
              <div>
                <label className="form-label">Work email</label>
                <input className="form-input" type="email" required placeholder="you@company.com" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
            </div>

            <div className="gs-grid" style={{ gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label className="form-label">Role</label>
                <select className="form-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                  <option value="">Select…</option>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="form-label">Company size</label>
                <select className="form-input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}>
                  <option value="">Select…</option>
                  {SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            </div>

            <div>
              <label className="form-label">Primary use case</label>
              <select className="form-input" value={form.use} onChange={(e) => setForm({ ...form, use: e.target.value })}>
                <option value="">Select…</option>
                {USES.map((u) => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>

            <div>
              <label className="form-label">Anything specific you want to see? <span style={{ color: "var(--text-muted)" }}>(optional)</span></label>
              <textarea className="form-input" rows={3} placeholder="e.g. policy enforcement in a LangChain agent, EU AI Act coverage, CI gate setup…" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} style={{ resize: "vertical" }} />
            </div>

            {status === "error" && (
              <p style={{ color: "var(--rose)", fontSize: "0.88rem" }}>
                Something went wrong — email <a href="mailto:contact@runback.dev" style={{ color: "var(--brand)" }}>contact@runback.dev</a> directly.
              </p>
            )}

            <button type="submit" className="btn-fill" disabled={status === "sending"} style={{ alignSelf: "flex-start" }}>
              {status === "sending" ? "Sending…" : "Book the demo →"}
            </button>
          </form>

          <p style={{ marginTop: "1.6rem", fontSize: "0.85rem", color: "var(--text-muted)" }}>
            Prefer email?{" "}
            <a href="mailto:contact@runback.dev?subject=Demo+request" style={{ color: "var(--brand)" }}>contact@runback.dev</a>
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
