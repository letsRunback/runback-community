import Link from "next/link";
import { Fragment } from "react";
import { requireSession, atLeast } from "@/lib/auth";
import { getSetupProgress } from "@/lib/onboardingProgress";
import { getEcosystemSnapshot, type SinkStatus } from "@/lib/ecosystem";
import ConnectSnippet from "../ConnectSnippet";
import GetStartedChecklist from "./GetStartedChecklist";
import EditionLink from "@/components/EditionLink";
import { routeAvailable } from "@/lib/edition";

const STATUS_LABEL: Record<SinkStatus, string> = {
  connected: "Connected",
  detected: "Detected",
  none: "Not configured",
};

export const dynamic = "force-dynamic";

const JOBS = [
  { n: "01", tone: "blue",    title: "Observe", body: "Every model call — context, tools, tokens — captured at the boundary. PII redacted in your process before anything leaves it." },
  { n: "02", tone: "violet",  title: "Replay",  body: "Re-run any incident from the exact captured context — tools, retrieval, messages[] held fixed. A different output means behavior changed." },
  { n: "03", tone: "amber",   title: "Gate",    body: "Simulate a policy against your production history before you ship it, then enforce it live — the violating action never runs." },
  { n: "04", tone: "emerald", title: "Audit",   body: "Every decision sealed in a SHA-256 hash chain, Ed25519-signed. Tamper-evident — the record your auditor asks for." },
] as const;

export default async function GetStarted() {
  const session = await requireSession();
  const canAdmin = atLeast(session.role, "admin");
  const [progress, eco] = await Promise.all([
    getSetupProgress(session.orgId),
    getEcosystemSnapshot(session.orgId),
  ]);

  return (
    <div className="appc">
      <div className="appc-head">
        <h1 className="appc-h1">Get started</h1>
        <p className="appc-sub">
          {progress.done === progress.total
            ? "You're fully set up — every part of the platform is live for your fleet."
            : `${progress.done} of ${progress.total} steps done — the rest take a couple of minutes.`}
        </p>
      </div>

      <section className="gs-section">
        <div className="gs-section-h">How Runback works</div>
        <div className="four-jobs gs-jobs">
          {JOBS.map((j, i) => (
            <Fragment key={j.n}>
              {i > 0 && <div className="job-connector" aria-hidden="true"><span className="job-connector-arrow">→</span></div>}
              <div className="job-card" data-tone={j.tone}>
                <span className="job-n mono">{j.n}</span>
                <h3>{j.title}</h3>
                <p>{j.body}</p>
              </div>
            </Fragment>
          ))}
        </div>
      </section>

      <section className="gs-section">
        <div className="gs-section-h">Your setup</div>
        <GetStartedChecklist steps={progress.steps} />
      </section>

      <section className="gs-section">
        <div className="gs-section-h">How data flows</div>

        <div className="eco-diagram">
          <div className="eco-col">
            <div className="eco-col-h">Your agents → Runback</div>
            {eco.agents.length === 0 ? (
              <p className="eco-empty">No agents connected yet — issue a key below.</p>
            ) : (
              <>
                {eco.agents.map((a) => (
                  <div key={a.name} className="eco-agent-chip">
                    <span className="eco-agent-name mono">{a.name}</span>
                    <span className="eco-agent-count mono">{a.count}</span>
                  </div>
                ))}
                {eco.agentCount > eco.agents.length && (
                  <p className="eco-more mono">+{eco.agentCount - eco.agents.length} more</p>
                )}
                <p className="eco-caption mono">{eco.runs24h.toLocaleString()} runs in the last 24h</p>
              </>
            )}
          </div>

          <div className="eco-center" aria-hidden>
            <span>→</span>
            <span className="eco-center-label">runback</span>
          </div>

          <div className="eco-col">
            <div className="eco-col-h">Runback → your stack</div>
            {eco.sinks.filter((s) => routeAvailable(s.href)).map((s) => (
              <Link key={s.label} href={s.href} className="eco-sink-row">
                <span>
                  <span className="eco-sink-label">{s.label}</span>
                  <span className="eco-sink-detail mono">{s.detail}</span>
                </span>
                <span className="eco-status-pill mono" data-status={s.status}>{STATUS_LABEL[s.status]}</span>
              </Link>
            ))}
          </div>
        </div>

        <div className="gs-flow-row">
          <div className="onb-card gs-connect-card">
            <div className="gs-flow-dir mono">IN — your agent → Runback</div>
            {/* Said "Every integration below…" while the component underneath
                renders a single "Get an API key" button until a key exists — so
                on first visit, the sentence pointed at nothing. */}
            <p className="gs-connect-lead">
              Every integration sends the same event shape — a run start, one or more model/tool calls, a run end.
              No infrastructure to stand up: the SDKs are a single import, cURL needs nothing installed, and OTel just
              needs your existing exporter pointed at Runback&apos;s endpoint. Data never leaves your process unredacted.
              Issue a key below and the snippets appear, filled in with it.
            </p>
            <ConnectSnippet canAdmin={canAdmin} />
          </div>
          <div className="onb-card gs-connect-card">
            <div className="gs-flow-dir mono">OUT — Runback → your stack</div>
            <p className="gs-connect-lead">
              Alerts go to email, Slack, or any webhook — configure a rule under <EditionLink href="/app/alerts" className="appc-link">Alerts</EditionLink>.
              The full audit and admin-action log streams to your own SIEM (Splunk, Sentinel, or a generic webhook)
              under <Link href="/app/settings" className="appc-link">Settings → SIEM export</Link>. Compliance, regulatory, and cost/chargeback
              reports export on demand as structured JSON or CSV from their own pages. Nothing leaves silently — every
              sink is something you configured with your own endpoint and key.
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
