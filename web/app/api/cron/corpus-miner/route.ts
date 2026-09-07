/**
 * Corpus miner — auto-mines real production failures (policy-blocked tool
 * calls, low-scoring eval items) into adversarial test proposals, closing
 * the gap web/lib/eval/adversarial.ts's proposeAdversarialScenarios() left:
 * it already generates scenarios via an LLM, but only from a single
 * hand-picked seed run's context, never from an actual observed weak spot.
 * More runs observed → richer failure corpus → better test coverage — a
 * genuine data network effect, not just data accumulation (a16z's standing
 * critique of "data moat" claims requires exactly this loop to hold).
 *
 * Every mined item still lands `source: "synthetic"`, `approval_status:
 * "pending"` (datasets.ts addSyntheticItem) — this cron changes what SEEDS
 * a proposal, never what approves one. A human reviews every item before it
 * can affect an eval's gating_pass_rate, unchanged from the manual
 * generation path.
 *
 * Follows policy-causes.ts's bulk-fetch-then-group-by-org shape for signal
 * DISCOVERY (ad_events/ad_eval_scores have no direct org_id — cheaper to
 * join once than loop per-org), then adversarial-guard.ts's per-org
 * try/catch loop for the actual generation+dataset-write step, since that
 * genuinely is a per-org action (entitlement check, dataset lookup, LLM
 * call, BYOK keys).
 */
import { NextRequest, NextResponse } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { readAll } from "@/lib/supabase/read";
import { orgHasFeature } from "@/lib/planGate";
import { cronAuthorized } from "@/lib/cronAuth";
import { DEMO_MODE, showcaseOrgId } from "@/lib/demoMode";
import { getOrgKeys } from "@/lib/modelKeys";
import { listDatasets, createDataset, addSyntheticItem, type DatasetRow } from "@/lib/eval/datasets";
import { proposeAdversarialScenarios, scenarioToItem, type GenerateContext } from "@/lib/eval/adversarial";
import { minedSignalKey, rankAndCapCandidates, isNearDuplicateText } from "@/lib/eval/corpusMiner";
import { inputTextOf } from "@runback/policy";

export const runtime = "nodejs";
export const maxDuration = 300;

// Cron-unattended cap — deliberately lower than the manual route's per-click
// defaults. This runs daily with no human watching; a signal that keeps
// failing to generate would otherwise crowd out fresh ones from the same
// org every single day.
const MAX_SIGNALS_PER_ORG = 5;
const SCENARIOS_PER_SIGNAL = 2;
const AUTO_MINED_DATASET_NAME = "Auto-mined failures";

// 26h, not 24h: this cron is meant to run once daily; the 2h buffer absorbs
// ordinary schedule jitter without creating a gap a stricter 24h window
// could leave between two runs. The dedup table (ad_corpus_mined_signals)
// makes the resulting one-time overlap a no-op, not a duplicate.
const LOOKBACK_MS = 26 * 3600_000;

interface PolicyBlockCandidate {
  kind: "policy_block";
  signalRef: string; // ad_events.id
  orgId: string;
  runId: string;
  tsStart: string;
  detail: string;
}
interface LowScoreCandidate {
  kind: "low_score";
  signalRef: string; // ad_eval_scores.id
  orgId: string;
  datasetItemId: string;
  tsStart: string;
  detail: string;
}
type Candidate = PolicyBlockCandidate | LowScoreCandidate;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Sb = any;

async function findPolicyBlockCandidates(sb: Sb, since: string): Promise<PolicyBlockCandidate[]> {
  const events = await readAll<{ id: string; run_id: string; ts_start: string; data: unknown }>(
    (from, to) =>
      sb.from("ad_events").select("id, run_id, ts_start, data").eq("type", "tool").eq("policy_blocked", true).gte("ts_start", since).range(from, to),
    "corpus-miner: blocked tool events"
  );
  if (!events.length) return [];

  const runIds = [...new Set(events.map((e) => e.run_id))];
  const runs: { run_id: string; org_id: string }[] = [];
  const CHUNK = 500;
  for (let i = 0; i < runIds.length; i += CHUNK) {
    const part = runIds.slice(i, i + CHUNK);
    runs.push(
      ...(await readAll<{ run_id: string; org_id: string }>(
        (from, to) => sb.from("ad_runs").select("run_id, org_id").in("run_id", part).range(from, to),
        "corpus-miner: runs for blocked events"
      ))
    );
  }
  const orgByRun = new Map(runs.map((r) => [r.run_id, r.org_id]));

  const out: PolicyBlockCandidate[] = [];
  for (const ev of events) {
    const orgId = orgByRun.get(ev.run_id);
    if (!orgId) continue;
    const block = (ev.data as { policy_block?: { rule?: string; detail?: string } })?.policy_block;
    if (!block?.rule) continue;
    out.push({
      kind: "policy_block",
      signalRef: ev.id,
      orgId,
      runId: ev.run_id,
      tsStart: ev.ts_start,
      detail: `Blocked by policy rule "${block.rule}"${block.detail ? `: ${block.detail}` : ""}`,
    });
  }
  return out;
}

async function findLowScoreCandidates(sb: Sb, since: string): Promise<LowScoreCandidate[]> {
  const scores = await readAll<{ id: string; item_id: string; results: unknown; created_at: string }>(
    (from, to) => sb.from("ad_eval_scores").select("id, item_id, results, created_at").eq("passed", false).gte("created_at", since).range(from, to),
    "corpus-miner: low-scoring eval items"
  );
  if (!scores.length) return [];

  const itemIds = [...new Set(scores.map((s) => s.item_id))];
  const items: { id: string; dataset_id: string }[] = [];
  const CHUNK = 500;
  for (let i = 0; i < itemIds.length; i += CHUNK) {
    const part = itemIds.slice(i, i + CHUNK);
    items.push(
      ...(await readAll<{ id: string; dataset_id: string }>(
        (from, to) => sb.from("ad_dataset_items").select("id, dataset_id").in("id", part).range(from, to),
        "corpus-miner: dataset items for low scores"
      ))
    );
  }
  const datasetByItem = new Map(items.map((it) => [it.id, it.dataset_id]));

  const datasetIds = [...new Set(items.map((it) => it.dataset_id))];
  const datasets: { id: string; org_id: string | null }[] = [];
  for (let i = 0; i < datasetIds.length; i += CHUNK) {
    const part = datasetIds.slice(i, i + CHUNK);
    datasets.push(
      ...(await readAll<{ id: string; org_id: string | null }>(
        (from, to) => sb.from("ad_datasets").select("id, org_id").in("id", part).range(from, to),
        "corpus-miner: datasets for low scores"
      ))
    );
  }
  const orgByDataset = new Map(datasets.map((d) => [d.id, d.org_id]));

  const out: LowScoreCandidate[] = [];
  for (const s of scores) {
    const datasetId = datasetByItem.get(s.item_id);
    const orgId = datasetId ? orgByDataset.get(datasetId) : null;
    if (!orgId) continue;
    // First failing scorer's own detail string is already human-readable
    // (e.g. "0.32 vs 0.6 threshold — reason") — reuse it rather than
    // reconstructing rubric text this module has no business parsing.
    const results = (s.results as { passed: boolean; detail?: string }[] | null) ?? [];
    const failing = results.find((r) => !r.passed);
    if (!failing?.detail) continue;
    out.push({
      kind: "low_score",
      signalRef: s.id,
      orgId,
      datasetItemId: s.item_id,
      tsStart: s.created_at,
      detail: `Failed grading: ${failing.detail}`,
    });
  }
  return out;
}

/** The seed context (system prompt + tools) for a candidate, pulled from
 *  whatever real captured content is available for it — a run's first LLM
 *  event for a policy-block candidate, or the dataset item's own stored
 *  request for a low-score candidate (it's already a captured/synthetic
 *  request, no run lookup needed). */
async function contextFor(sb: Sb, c: Candidate): Promise<{ system: string | null; tools: { name: string; description?: string }[] }> {
  if (c.kind === "low_score") {
    const { data } = await sb.from("ad_dataset_items").select("request").eq("id", c.datasetItemId).maybeSingle();
    const req = data?.request as { system?: string | null; tools?: { name: string; description?: string }[] } | undefined;
    return { system: req?.system ?? null, tools: req?.tools ?? [] };
  }
  const { data } = await sb
    .from("ad_events")
    .select("data")
    .eq("run_id", c.runId)
    .eq("type", "llm")
    .order("seq", { ascending: true })
    .limit(1)
    .maybeSingle();
  const req = (data?.data as { request?: { system?: string | null; tools?: { name: string; description?: string }[] } } | null)?.request;
  return { system: req?.system ?? null, tools: req?.tools ?? [] };
}

async function findOrCreateMinedDataset(orgId: string): Promise<DatasetRow> {
  const existing = await listDatasets(orgId);
  const found = existing.find((d) => d.name === AUTO_MINED_DATASET_NAME);
  if (found) return found;
  const created = await createDataset({ name: AUTO_MINED_DATASET_NAME, description: "Adversarial scenarios auto-proposed from real production failures — review before approving.", org_id: orgId });
  return { ...created, item_count: 0 };
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sb = getAdminClient() as Sb;
  const since = new Date(Date.now() - LOOKBACK_MS).toISOString();

  let policyBlocks: PolicyBlockCandidate[];
  let lowScores: LowScoreCandidate[];
  try {
    [policyBlocks, lowScores] = await Promise.all([findPolicyBlockCandidates(sb, since), findLowScoreCandidates(sb, since)]);
  } catch (e) {
    console.error("[cron/corpus-miner] candidate discovery failed:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }

  const allCandidates: Candidate[] = [...policyBlocks, ...lowScores];
  if (!allCandidates.length) return NextResponse.json({ ok: true, orgs: 0, mined: 0 });

  const orgIds = [...new Set(allCandidates.map((c) => c.orgId))];

  // Exclude signals already mined, scoped to the orgs actually in play —
  // this table has no org index need beyond this cron's own reads.
  const already = await readAll<{ org_id: string; signal_kind: string; signal_ref: string }>(
    (from, to) => sb.from("ad_corpus_mined_signals").select("org_id, signal_kind, signal_ref").in("org_id", orgIds).range(from, to),
    "corpus-miner: already-mined signals"
  );
  const alreadyMined = new Set(already.map((a) => minedSignalKey(a.org_id, a.signal_kind, a.signal_ref)));
  const fresh = allCandidates.filter((c) => !alreadyMined.has(minedSignalKey(c.orgId, c.kind, c.signalRef)));
  if (!fresh.length) return NextResponse.json({ ok: true, orgs: orgIds.length, mined: 0, reason: "no unmined signals" });

  const byOrg = new Map<string, Candidate[]>();
  for (const c of fresh) byOrg.set(c.orgId, [...(byOrg.get(c.orgId) ?? []), c]);

  const showcaseId = await showcaseOrgId();
  const summary: Record<string, unknown> = {};
  let totalMined = 0;
  let errors = 0;

  for (const [orgId, candidates] of byOrg) {
    try {
      if (!(await orgHasFeature(orgId, "upgrade_gate"))) {
        summary[orgId] = { skipped: "not entitled" };
        continue;
      }

      const selected = rankAndCapCandidates(candidates, MAX_SIGNALS_PER_ORG);

      const demo = DEMO_MODE || orgId === showcaseId;
      const keys = demo ? undefined : await getOrgKeys(orgId);
      const dataset = await findOrCreateMinedDataset(orgId);

      let minedForOrg = 0;
      let duplicatesSkipped = 0;
      const minedRows: { org_id: string; signal_kind: string; signal_ref: string; dataset_id: string | null }[] = [];

      // Content-level dedup (corpusMiner.ts's isNearDuplicateText) on top of
      // minedSignalKey's per-incident dedup above — that key stops the SAME
      // production incident being re-mined, not two DIFFERENT signals
      // producing near-identical scenario text over time. Seeded from every
      // item already in this dataset (mined earlier, or otherwise), then
      // grown as this run adds items, so duplicates are caught both across
      // runs and within a single run.
      const { data: existingItems } = await sb.from("ad_dataset_items").select("request").eq("dataset_id", dataset.id);
      const seenTexts: string[] = ((existingItems ?? []) as { request: unknown }[])
        .map((r) => inputTextOf(r.request))
        .filter((t): t is string => !!t);

      for (const c of selected) {
        const { system, tools } = await contextFor(sb, c);
        const ctx: GenerateContext = {
          system,
          tools,
          count: SCENARIOS_PER_SIGNAL,
          failureSeed: { kind: c.kind, detail: c.detail },
        };
        let scenarios;
        try {
          scenarios = await proposeAdversarialScenarios(ctx, keys, demo);
        } catch (e) {
          // Recorded as mined regardless — an unattended daily cron must not
          // let one perpetually-unparseable signal occupy a cap slot every
          // single day. The manual UI path is still available for a human
          // to retry this exact case by hand if they want to.
          console.error(`[cron/corpus-miner] org ${orgId} signal ${c.signalRef} generation failed:`, e instanceof Error ? e.message : e);
          minedRows.push({ org_id: orgId, signal_kind: c.kind, signal_ref: c.signalRef, dataset_id: null });
          continue;
        }
        for (const scenario of scenarios) {
          const item = scenarioToItem(scenario, system);
          const candidateText = inputTextOf(item.request);
          if (candidateText && isNearDuplicateText(candidateText, seenTexts)) {
            duplicatesSkipped++;
            continue;
          }
          await addSyntheticItem({
            dataset_id: dataset.id,
            label: item.label,
            request: item.request,
            model: { provider: "groq", model_id: "llama-3.3-70b-versatile" },
            scorers: item.scorers,
            generated_rationale: item.generated_rationale,
            generated_from_run_id: c.kind === "policy_block" ? c.runId : null,
          });
          if (candidateText) seenTexts.push(candidateText);
          minedForOrg++;
        }
        minedRows.push({ org_id: orgId, signal_kind: c.kind, signal_ref: c.signalRef, dataset_id: dataset.id });
      }

      if (minedRows.length) {
        const { error: insErr } = await sb.from("ad_corpus_mined_signals").insert(minedRows);
        if (insErr) console.error(`[cron/corpus-miner] org ${orgId} failed to record mined signals:`, insErr.message);
      }

      totalMined += minedForOrg;
      summary[orgId] = { candidates: candidates.length, selected: selected.length, items_created: minedForOrg, items_skipped_duplicate: duplicatesSkipped, dataset_id: dataset.id };
    } catch (e) {
      errors++;
      const message = e instanceof Error ? e.message : String(e);
      console.error(`[cron/corpus-miner] org ${orgId} failed, continuing with remaining orgs:`, message);
      summary[orgId] = { error: message };
    }
  }

  return NextResponse.json({ ok: true, orgs: byOrg.size, mined: totalMined, errors, summary });
}
