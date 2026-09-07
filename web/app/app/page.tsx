import Link from "next/link";
import { requireSession, atLeast } from "@/lib/auth";
import { getOrgOverview, getOrgBasic } from "@/lib/dashboard";
import { can } from "@/lib/entitlements";
import Onboarding from "./Onboarding";
import { Sparkline, HealthRing, AreaChart, Donut, HBar } from "@/components/app/charts";
import { PRICING_HREF } from "@/lib/edition";

export const dynamic = "force-dynamic";

const fmtN = (n: number) => n.toLocaleString();
const fmtPct = (n: number) => `${(n * 100).toFixed(n > 0 && n < 0.1 ? 1 : 0)}%`;
const fmtUsd = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n >= 1 ? `$${n.toFixed(0)}` : `$${n.toFixed(2)}`);
const fmtMs = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s` : `${ms}ms`);

function Delta({ now, prev, goodWhenDown = false }: { now: number; prev: number; goodWhenDown?: boolean }) {
  if (prev === 0 && now === 0) return <span className="kpi-delta" data-flat>—</span>;
  const change = prev === 0 ? 1 : (now - prev) / prev;
  if (Math.abs(change) < 0.005) return <span className="kpi-delta" data-flat>±0%</span>;
  const up = change > 0;
  const good = goodWhenDown ? !up : up;
  return (
    <span className="kpi-delta" data-good={good || undefined} data-bad={!good || undefined}>
      {up ? "▲" : "▼"} {fmtPct(Math.abs(change))}
    </span>
  );
}

export default async function AppOverview() {
  const session = await requireSession();

  // First-run: empty workspace → a guided onboarding instead of an empty page.
  const seed = await getOrgBasic(session.orgId).catch(() => ({ total: 0, errors: 0, success: 0 }));
  if (seed.total === 0) {
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">{session.orgName}</h1>
          <p className="appc-sub">Your workspace is ready — let&apos;s see it work.</p>
        </div>
        <Onboarding canAdmin={atLeast(session.role, "admin")} />
      </div>
    );
  }

  // Free tier (Community / dev-tools): a basic overview, with the full fleet
  // control room as a Pro+ upgrade.
  if (!can(session.orgPlan, "dashboard")) {
    const basic = await getOrgBasic(session.orgId).catch(() => ({ total: 0, errors: 0, success: 0 }));
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">{session.orgName}</h1>
          <p className="appc-sub">Your workspace.</p>
        </div>
        <div className="kpi-row kpi-row-3">
          <div className="kpi"><div className="kpi-k">Runs</div><div className="kpi-v">{fmtN(basic.total)}</div></div>
          <div className="kpi"><div className="kpi-k">Succeeded</div><div className="kpi-v">{fmtN(basic.success)}</div></div>
          <div className="kpi" data-tone={basic.errors > 0 ? "rose" : undefined}><div className="kpi-k">Failed</div><div className="kpi-v">{fmtN(basic.errors)}</div></div>
        </div>
        <p className="empty dash-empty-note">
          See your runs in <Link href="/app/runs" className="appc-link">Runs</Link>.
        </p>
        <div className="upsell">
          <div className="upsell-badge mono">Scale · Pro · Enterprise</div>
          <h2>Unlock the control room</h2>
          <p>Fleet dashboards — error-rate trends, latency (p95), cost, top agents, and a needs-attention feed — plus team roles and alerting. On Scale and above.</p>
          <div className="hero-cta">
            <Link href={PRICING_HREF} className="btn-fill">See plans →</Link>
            <Link href="/contact" className="btn-line">Talk to us</Link>
          </div>
        </div>
      </div>
    );
  }

  let ov: Awaited<ReturnType<typeof getOrgOverview>> | null = null;
  try {
    ov = await getOrgOverview(session.orgId);
  } catch {
    /* DB unreachable */
  }

  if (!ov) {
    return (
      <div className="appc">
        <div className="appc-head"><h1 className="appc-h1">Overview</h1></div>
        <p className="empty">Could not reach the database.</p>
      </div>
    );
  }

  if (ov.totalRuns === 0) {
    return (
      <div className="appc">
        <div className="appc-head">
          <h1 className="appc-h1">{session.orgName}</h1>
          <p className="appc-sub">Fleet overview — every agent in your workspace, at a glance.</p>
        </div>
        <div className="appc-empty">
          <p>No runs yet.</p>
          <p className="empty dash-empty-sm">
            Send your first run from <Link href="/app/get-started" className="appc-link">get started</Link> and this control room fills in.
          </p>
        </div>
      </div>
    );
  }

  const maxAgent = Math.max(1, ...ov.topAgents.map((a) => a.count));
  const health = 1 - ov.errorRate;
  const dailyTotals = ov.days.map((d) => d.total);
  const dailyErrors = ov.days.map((d) => d.errors);
  const dailyDates = ov.days.map((d) => d.date);

  return (
    <div className="appc dash2">
      {/* Hero */}
      <div className="dash2-hero">
        <div>
          <h1 className="appc-h1">{session.orgName}</h1>
          <p className="appc-sub">Fleet overview · last 14 days · {fmtN(ov.totalRuns)} runs in window</p>
        </div>
        <div className="dash2-health">
          <HealthRing pct={health} />
        </div>
      </div>

      {/* KPI strip with sparklines */}
      <div className="kpi-row">
        <div className="kpi kpi2">
          <div className="kpi2-top"><div className="kpi-k">Runs · 7d</div><Delta now={ov.runs7} prev={ov.runsPrev7} /></div>
          <div className="kpi-v">{fmtN(ov.runs7)}</div>
          <Sparkline values={dailyTotals} labels={dailyDates} />
        </div>
        <div className="kpi kpi2" data-tone={ov.errRate7 > 0.1 ? "rose" : undefined}>
          <div className="kpi2-top"><div className="kpi-k">Error rate · 7d</div><Delta now={ov.errRate7} prev={ov.errRatePrev7} goodWhenDown /></div>
          <div className="kpi-v">{fmtPct(ov.errRate7)}</div>
          <Sparkline values={dailyErrors} labels={dailyDates} color="var(--rose)" />
        </div>
        <div className="kpi kpi2">
          <div className="kpi2-top"><div className="kpi-k">Latency</div></div>
          <div className="kpi-v">{fmtMs(ov.avgLatencyMs)}</div>
          <div className="kpi-sub mono">avg · p95 {fmtMs(ov.p95LatencyMs)}</div>
        </div>
        <div className="kpi kpi2">
          <div className="kpi2-top"><div className="kpi-k">Est. spend</div></div>
          <div className="kpi-v">{fmtUsd(ov.estCostUsd)}</div>
          <div className="kpi-sub mono">{fmtN(ov.totalTokens)} tokens</div>
        </div>
      </div>

      {/* Main chart + status */}
      <div className="dash2-grid">
        <section className="dash-panel">
          <div className="dash-panel-h">Activity<span className="dash-legend"><i className="lg lg-ok" /> runs <i className="lg lg-err" /> errors</span></div>
          <AreaChart days={ov.days} />
        </section>
        <section className="dash-panel dash2-status">
          <div className="dash-panel-h">Status</div>
          <Donut segments={[
            { value: ov.success, color: "var(--emerald)", label: "success" },
            { value: ov.errors, color: "var(--rose)", label: "error" },
            { value: ov.running, color: "var(--blue)", label: "running" },
          ]} />
          <ul className="dash2-legend">
            <li><i className="dash-leg-success" />Success<span className="mono">{fmtN(ov.success)}</span></li>
            <li><i className="dash-leg-error" />Error<span className="mono">{fmtN(ov.errors)}</span></li>
            <li><i className="dash-leg-running" />Running<span className="mono">{fmtN(ov.running)}</span></li>
          </ul>
        </section>
      </div>

      {/* Agents + failures */}
      <div className="dash2-grid">
        <section className="dash-panel">
          <div className="dash-panel-h">Top agents</div>
          <ul className="dash-agents">
            {ov.topAgents.map((a) => (
              <li key={a.name}>
                <div className="dash-agent-top">
                  <span className="mono dash-agent-n">{a.name}</span>
                  <span className="dash-agent-c mono">{fmtN(a.count)}</span>
                </div>
                <HBar
                  pct={(a.count / maxAgent) * 100} color="var(--blue)"
                  label={a.name}
                  valueText={`${fmtN(a.count)} runs · ${fmtPct(a.errorRate)} err`}
                />
                <div className="dash-agent-meta mono">
                  <span data-bad={a.errorRate > 0.1 || undefined}>{fmtPct(a.errorRate)} err</span>
                  <span>{fmtN(a.tokens)} tok</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
        <section className="dash-panel">
          <div className="dash-panel-h">Needs attention</div>
          {ov.recentFailures.length === 0 ? (
            <p className="empty dash-empty-inline">No failures in the window. 🎉</p>
          ) : (
            <ul className="dash-fails">
              {ov.recentFailures.slice(0, 6).map((f) => (
                <li key={f.run_id}>
                  <span className="dash-fail-dot" />
                  <Link href={`/app/runs/${f.run_id}`} className="mono appc-link">{f.name}</Link>
                  <span className="dash-fail-msg">{f.error}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
