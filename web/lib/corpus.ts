/**
 * Per-org agent health signals — mines this org's own ad_run_rollups to
 * surface anomalies (error spikes, token spikes, trend shifts) without
 * touching individual run payloads. Anomalies are computed per-agent vs.
 * the org's own baseline over a 14-day window.
 * Pro+ feature ("corpus"). Org-scoped only — no cross-tenant leakage.
 * For cross-tenant/peer comparison, see benchmark.ts.
 */
import { getAdminClient } from "@/lib/supabase/admin";

export interface AgentSignal {
  agent: string;
  runs: number;
  errorRate: number;
  orgErrorRate: number;
  anomaly: "high_error" | "trending_up" | "token_spike" | "healthy";
  anomalyScore: number;        // 0..1, higher = more urgent
  trend: "up" | "down" | "flat";
  tokens: number;
  avgTokens: number;
  orgAvgTokensPerRun: number;
  errRate7d: number;
  errRatePrev7d: number;
}

export interface CorpusOverview {
  signals: AgentSignal[];
  orgErrorRate: number;
  orgAvgTokensPerRun: number;
  totalRuns: number;
  windowDays: number;
}

export async function getCorpusSignals(orgId: string): Promise<CorpusOverview> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = getAdminClient() as any;

  const since14 = new Date(Date.now() - 13 * 86400_000).toISOString().slice(0, 10);
  const { data: roll } = await sb
    .from("ad_run_rollups")
    .select("day,agent,runs,errors,success,tokens")
    .eq("org_id", orgId)
    .gte("day", since14);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: any[] = roll ?? [];
  const now = Date.now();

  type AgentAgg = {
    runs: number; errors: number; tokens: number;
    runs7: number; err7: number; runsPrev7: number; errPrev7: number;
  };
  const byAgent = new Map<string, AgentAgg>();
  let orgRuns = 0, orgErrors = 0, orgTokens = 0;

  for (const r of rows) {
    const runs = Number(r.runs), errs = Number(r.errors), toks = Number(r.tokens);
    orgRuns += runs; orgErrors += errs; orgTokens += toks;

    const a: AgentAgg = byAgent.get(r.agent) ?? { runs: 0, errors: 0, tokens: 0, runs7: 0, err7: 0, runsPrev7: 0, errPrev7: 0 };
    a.runs += runs; a.errors += errs; a.tokens += toks;

    const ageDays = (now - new Date(r.day + "T00:00:00Z").getTime()) / 86400_000;
    if (ageDays < 7) { a.runs7 += runs; a.err7 += errs; }
    else { a.runsPrev7 += runs; a.errPrev7 += errs; }

    byAgent.set(r.agent, a);
  }

  const orgErrorRate = orgRuns > 0 ? orgErrors / orgRuns : 0;
  const orgAvgTokensPerRun = orgRuns > 0 ? orgTokens / orgRuns : 0;

  const signals: AgentSignal[] = [];
  for (const [agent, a] of byAgent.entries()) {
    if (a.runs === 0) continue;
    const errorRate = a.errors / a.runs;
    const avgTokens = a.tokens / a.runs;
    const errRate7d = a.runs7 > 0 ? a.err7 / a.runs7 : 0;
    const errRatePrev7d = a.runsPrev7 > 0 ? a.errPrev7 / a.runsPrev7 : 0;

    const trend: AgentSignal["trend"] =
      Math.abs(errRate7d - errRatePrev7d) < 0.02 ? "flat" :
      errRate7d > errRatePrev7d ? "up" : "down";

    let anomalyScore = 0;
    let anomaly: AgentSignal["anomaly"] = "healthy";
    const errRatio = orgErrorRate > 0 ? errorRate / orgErrorRate : errorRate * 10;
    const tokRatio = orgAvgTokensPerRun > 0 ? avgTokens / orgAvgTokensPerRun : 1;

    if (trend === "up" && errRate7d > 0.05 && errRate7d > errRatePrev7d * 1.5) {
      anomaly = "trending_up";
      anomalyScore = Math.min(1, (errRate7d - errRatePrev7d) * 5);
    } else if (errRatio >= 2) {
      anomaly = "high_error";
      anomalyScore = Math.min(1, (errRatio - 1) / 4);
    } else if (tokRatio >= 3 && a.runs >= 10) {
      anomaly = "token_spike";
      anomalyScore = Math.min(1, (tokRatio - 2) / 5);
    }

    signals.push({ agent, runs: a.runs, errorRate, orgErrorRate, anomaly, anomalyScore, trend, tokens: a.tokens, avgTokens, orgAvgTokensPerRun, errRate7d, errRatePrev7d });
  }

  signals.sort((a, b) => b.anomalyScore - a.anomalyScore || b.runs - a.runs);
  return { signals, orgErrorRate, orgAvgTokensPerRun, totalRuns: orgRuns, windowDays: 14 };
}
