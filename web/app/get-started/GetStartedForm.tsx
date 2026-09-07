"use client";

import { useState } from "react";

function Cmd({ label, cmd }: { label: string; cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="gs-cmd">
      <div className="gs-cmd-label">{label}</div>
      <div className="gs-cmd-box">
        <pre className="gs-cmd-pre mono">{cmd}</pre>
        <button
          type="button"
          className="gs-cmd-copy mono"
          onClick={() => {
            navigator.clipboard?.writeText(cmd).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

export default function GetStartedForm({ emailEnabled = false }: { emailEnabled?: boolean }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [useCase, setUseCase] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, company, useCase, source: "get-started" }),
      });
      const data = await res.json();
      if (data.ok) {
        setApiKey(data.apiKey ?? null);
        setStatus("done");
      } else if (data.code === "store") {
        // storage not ready — never lose the lead: hand off via email, still succeed
        const subj = encodeURIComponent("Runback Community edition access");
        const bodyTxt = encodeURIComponent(`Work email: ${email}\nCompany: ${company}\nUse case: ${useCase}`);
        window.location.href = `mailto:contact@runback.dev?subject=${subj}&body=${bodyTxt}`;
        setStatus("done");
      } else {
        setError(data.error || "Something went wrong.");
        setStatus("error");
      }
    } catch {
      setError("Network error — please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    const key = apiKey ?? "rb_live_…";
    const oneLiner = `curl -fsSL https://runback.dev/api/quickstart | RUNBACK_API_KEY=${key} bash`;
    // The repo is private during the beta, so the clone only works once we have
    // sent an invite. Showing the command with that stated up front is honest;
    // showing it bare (as this did) sent everyone to a 404.
    const selfhost = "git clone https://github.com/letsRunback/runback\ncd runback && docker compose up";
    return (
      <div>
        <div className="gs-reveal-h mono">✓ You&apos;re in</div>
        <p style={{ margin: "0.8rem 0 0", color: "var(--text-secondary)", fontSize: "0.92rem" }}>
          {emailEnabled && <>A welcome is on its way to <span className="mono">{email}</span>. </>}
          Pick a path — copy, paste, run.
        </p>

        <div className="gs-path-h mono">Fastest — send your first run to our hosted instance</div>
        {apiKey ? (
          <>
            <Cmd label="Your API key (shown once — save it)" cmd={apiKey} />
            <Cmd label="Send a sample run, then open it on runback.dev/runs" cmd={oneLiner} />
          </>
        ) : (
          <p className="empty" style={{ fontSize: "0.85rem" }}>
            Key issuing is warming up — <a href="/contact" style={{ color: "var(--brand)" }}>ping us</a> and we&apos;ll send one.
          </p>
        )}

        <div className="gs-path-h mono" style={{ marginTop: "1.6rem" }}>Or self-host in your own cloud</div>
        <p className="empty" style={{ fontSize: "0.85rem", margin: "0 0 0.5rem" }}>
          The self-host repository is private during the beta. You&apos;re on the list —
          we&apos;ll email <span className="mono">{email}</span> a GitHub invite, and then
          these two commands are the whole install:
        </p>
        <Cmd label="Needs Docker. Bundles its own database — open http://localhost:3000" cmd={selfhost} />
        <p className="empty" style={{ fontSize: "0.8rem", margin: "0.5rem 0 0" }}>
          Connecting your own LLMs is optional — observing agents needs no keys.
          For live step-replay or evals, add your OpenAI / Anthropic / Groq key to{" "}
          <span className="mono">.env</span>; the self-hosting guide ships in the repo at{" "}
          <span className="mono">docs/SELF_HOSTING.md</span>.
        </p>

        <p className="empty" style={{ marginTop: "1.4rem", fontSize: "0.85rem" }}>
          Verify the engine yourself —{" "}
          <a href="https://github.com/letsRunback/runback-proofs" target="_blank" rel="noopener noreferrer" style={{ color: "var(--brand)" }}>
            the determinism proof is public ↗
          </a>
        </p>
      </div>
    );
  }

  return (
    <form className="gs-form" onSubmit={submit}>
      <label className="gs-field">
        <span>Work email</span>
        <input
          type="email"
          required
          autoComplete="email"
          placeholder="you@yourcompany.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>
      <div className="gs-row">
        <label className="gs-field">
          <span>Company <em>(optional)</em></span>
          <input type="text" value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Acme Bank" />
        </label>
        <label className="gs-field">
          <span>What you&apos;re governing <em>(optional)</em></span>
          <input type="text" value={useCase} onChange={(e) => setUseCase(e.target.value)} placeholder="Support agents" />
        </label>
      </div>
      {status === "error" && <p className="gs-error">{error}</p>}
      <button className="btn-fill gs-submit" type="submit" disabled={status === "loading"}>
        {status === "loading" ? "…" : "Get the free Community edition →"}
      </button>
      <p className="gs-fine mono">Work email required. We use it to send your setup link — no spam.</p>
    </form>
  );
}
