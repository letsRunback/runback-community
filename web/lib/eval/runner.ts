/**
 * The eval runner. This is the assembly that proves the core insight:
 *
 *     eval = replay × dataset + scorers
 *
 * For each item in a dataset it replays the captured step (via the shared
 * `runStep`), runs every deterministic scorer, then the async `llm_judge`
 * scorers, writes one `ad_eval_scores` row, and updates the eval's aggregate
 * pass counts on `ad_eval_runs`.
 *
 * MVP: items run sequentially and the caller awaits completion. Datasets are
 * small; parallelism and background execution are a later optimization.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { runStep } from "@/lib/replay/runStep";
import type { LlmEvent } from "@runback/schema";
import {
  runDeterministicScorers,
  itemPassed,
  type ScorerConfig,
  type ScoreResult,
  type ReplayedOutput,
  type JsonShape,
} from "./scorers";
import { runLlmJudge, rubricHash, pickJudgeModel } from "./judge";
import { recordJudgeReview, getFewShotExamples } from "./calibration";
import { demoHash } from "./demoHash";
import { DEMO_MODE } from "@/lib/demoMode";

interface ItemRow {
  id: string;
  request: LlmEvent["request"];
  model: LlmEvent["model"];
  scorers: ScorerConfig[];
  /** Absent on a pre-migration DB — treated as "captured" (trusted), same as before this field existed. */
  source?: "captured" | "synthetic";
  approval_status?: "pending" | "approved" | "rejected" | null;
}

/** A synthetic (LLM-proposed) item counts toward the gating pass rate only once a human approved it. Exported for tests. */
export function isTrustedForGating(item: ItemRow): boolean {
  return item.source !== "synthetic" || item.approval_status === "approved";
}

/**
 * Load a dataset's items for the runner, tolerant of a database that hasn't
 * applied sql/add_adversarial_provenance.sql yet — falls back to the base
 * columns so an ordinary eval run never breaks for want of the newest
 * migration. Items from a pre-migration DB are all treated as "captured".
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
async function fetchRunnerItems(supabase: any, datasetId: string): Promise<ItemRow[]> {
  const rich = await supabase
    .from("ad_dataset_items")
    .select("id,request,model,scorers,source,approval_status")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: true });
  if (!rich.error) return (rich.data ?? []) as ItemRow[];

  const base = await supabase
    .from("ad_dataset_items")
    .select("id,request,model,scorers")
    .eq("dataset_id", datasetId)
    .order("created_at", { ascending: true });
  return (base.data ?? []) as ItemRow[];
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* ---------- demo: zero-cost, no-provider simulation of one eval item ---------- */

// demoHash lives in ./demoHash.ts — shared with pairwise.ts's simulated verdicts.

/* eslint-disable @typescript-eslint/no-explicit-any */
/** A minimal JSON value satisfying a shape — so demo json_schema scorers pass. */
function buildShapeExample(shape: JsonShape): unknown {
  if (shape.type === "array") return shape.items ? [buildShapeExample(shape.items)] : [];
  if (shape.type && shape.type !== "object") {
    return shape.type === "number" ? 1 : shape.type === "boolean" ? true : shape.type === "null" ? null : "x";
  }
  const obj: Record<string, unknown> = {};
  for (const key of shape.required ?? []) {
    const top = key.split(".")[0];
    const sub = shape.properties?.[top];
    obj[top] = sub ? buildShapeExample(sub) : "x";
  }
  for (const [k, sub] of Object.entries(shape.properties ?? {})) obj[k] = buildShapeExample(sub);
  return obj;
}

/** Set a dot-path on an object to a value (creating intermediate objects). */
function setPath(root: Record<string, unknown>, path: string, value: unknown): void {
  const segs = path.split(".");
  let node: any = root;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i];
    if (node[seg] == null || typeof node[seg] !== "object") node[seg] = {};
    node = node[seg];
  }
  node[segs[segs.length - 1]] = value;
}

/** Synthesize a tool call's args that satisfy a tool_arg op (so demo passes). */
function argValueFor(op: string, value: unknown): unknown {
  switch (op) {
    case "eq": case "contains": case "regex": return typeof value === "string" || typeof value === "number" ? value : "x";
    case "gte": case "lte": return typeof value === "number" ? value : 0;
    case "gt": return typeof value === "number" ? value + 1 : 1;
    case "lt": return typeof value === "number" ? value - 1 : -1;
    case "ne": return typeof value === "number" ? (value as number) + 1 : "≠";
    case "type": return value === "number" ? 1 : value === "boolean" ? true : value === "array" ? [] : value === "object" ? {} : "x";
    case "oneOf": return Array.isArray(value) ? value[0] : "x";
    case "exists": default: return "x";
  }
}

/**
 * Synthesize an item's replayed output WITHOUT calling a model, crafted to satisfy
 * the item's deterministic scorers so a demo shows a realistic, mostly-green run —
 * with the occasional deterministic regression so it doesn't look fake-perfect.
 */
function demoOutput(item: ItemRow): ReplayedOutput {
  let text = "";
  let finish_reason = "stop";
  const toolInputs: Record<string, Record<string, unknown>> = {};
  let jsonShape: JsonShape | null = null;
  let wantJson = false;
  let latBudget = Infinity;
  let tokBudget = Infinity;
  // Whether any configured scorer actually reads `text` — the synthetic
  // regression below only overwrites text, so injecting it for an item with
  // no text-sensitive scorer (e.g. tool_called/tool_arg only) would leave the
  // item passing every real scorer while showing a "regressed" caption next
  // to a PASS badge, self-contradictory to anyone reading the demo.
  let hasTextScorer = false;

  for (const cfg of item.scorers) {
    if (cfg.type === "exact_match") { text = cfg.expected; hasTextScorer = true; }
    else if (cfg.type === "contains") { text += (text ? " " : "") + cfg.value; hasTextScorer = true; }
    else if (cfg.type === "finish_reason") finish_reason = cfg.equals;
    else if (cfg.type === "json_valid") { wantJson = true; hasTextScorer = true; }
    else if (cfg.type === "json_schema") { wantJson = true; jsonShape = cfg.schema; hasTextScorer = true; }
    else if (cfg.type === "max_latency_ms") latBudget = Math.min(latBudget, cfg.budget);
    else if (cfg.type === "max_total_tokens") tokBudget = Math.min(tokBudget, cfg.budget);
    else if (cfg.type === "tool_called") {
      toolInputs[cfg.tool] ??= {};
      if (cfg.argEquals) for (const [k, v] of Object.entries(cfg.argEquals)) toolInputs[cfg.tool][k] = v;
    } else if (cfg.type === "tool_arg" && cfg.op !== "absent") {
      toolInputs[cfg.tool] ??= {};
      setPath(toolInputs[cfg.tool], cfg.path, argValueFor(cfg.op, cfg.value));
    }
  }

  if (wantJson) text = JSON.stringify(jsonShape ? buildShapeExample(jsonShape) : { ok: true });
  else if (!text) text = "Simulated demo response — no model was called.";

  // One item in ~9 "regresses": replace the expected content so a real scorer
  // fails. Keyed by item id → deterministic and stable across reruns. Only for
  // items with a text-sensitive scorer — a tool_called/tool_arg-only item has
  // nothing that reads `text`, so it would still pass every real scorer while
  // showing this caption, contradicting its own PASS badge.
  if (hasTextScorer && demoHash(item.id) % 9 === 0) {
    text = "Simulated regression — the model drifted off the expected answer.";
  }

  // Respect latency/token BUDGETS so a budget scorer isn't always-red in the demo
  // (the synthesized run is "fast and lean enough" to honestly pass them).
  const latency_ms = Math.min(120 + (demoHash(item.id) % 400), latBudget === Infinity ? Infinity : latBudget);
  const total_tokens = Math.min(40 + (demoHash(item.id) % 120), tokBudget === Infinity ? Infinity : tokBudget);

  return {
    text,
    finish_reason,
    tool_calls: Object.entries(toolInputs).map(([tool_name, input]) => ({ tool_name, input })),
    latency_ms,
    total_tokens,
    error: null,
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Run an eval to completion: replay + score every item, persist results. */
export async function runEval(evalId: string, opts?: { demo?: boolean }): Promise<void> {
  const demo = opts?.demo ?? DEMO_MODE;
  const supabase = getAdminClient() as any;

  const { data: ev } = await supabase
    .from("ad_eval_runs")
    .select("id,dataset_id,model_id,policy_id,org_id")
    .eq("id", evalId)
    .single();
  if (!ev) throw new Error(`Eval ${evalId} not found`);

  // Policy-as-code gate (optional): evaluate a versioned policy per item. Scope the
  // policy lookup to the eval's own org so an eval can't pull a foreign org's policy.
  let policy: { name: string; version: number; rules: any[] } | null = null;
  if (ev.policy_id) {
    const { getPolicy } = await import("./policies");
    const p = await getPolicy(ev.policy_id, ev.org_id ?? null);
    if (p) policy = { name: p.name, version: p.version, rules: p.rules };
  }

  // BYOK: real eval calls spend the EVAL'S OWN ORG provider keys (fall back to the
  // deployment env keys). Without this every eval silently billed the global key.
  const { getOrgKeys } = await import("@/lib/modelKeys");
  const orgKeys = demo ? undefined : await getOrgKeys(ev.org_id ?? null);

  const items = await fetchRunnerItems(supabase, ev.dataset_id);

  try {
    let passed = 0;
    let gatingTotal = 0, gatingPassed = 0;
    // Items the runner could not execute at all (missing provider key, rate
    // limit, provider 5xx). These are NOT behavioural results and must not be
    // scored as regressions — see the errored branch below.
    let infraErrors = 0;
    for (const item of items) {
      let output: ReplayedOutput;
      let scores: ScoreResult[];

      if (demo) {
        // Zero-cost: synthesize an output crafted to satisfy the scorers, then
        // run the REAL deterministic scorers so the pass/fail shown is honestly
        // computed — a realistic mostly-green run with the odd regression.
        output = demoOutput(item);
        scores = runDeterministicScorers(output, item.scorers);
        for (const cfg of item.scorers) {
          if (cfg.type === "llm_judge") {
            // Simulate the judge deterministically — no provider call.
            const s = 0.7 + (demoHash(item.id + ":judge") % 30) / 100; // 0.70..0.99
            const threshold = cfg.threshold ?? 0.5;
            scores.push({
              scorer: "llm_judge",
              passed: s >= threshold,
              score: Number(s.toFixed(2)),
              detail: "demo — simulated judge, no model call",
            });
          }
        }
        if (policy) {
          const { evaluatePolicy, inputTextOf } = await import("./policy");
          const pr = evaluatePolicy(policy as any, { output, inputText: inputTextOf(item.request) });
          for (const rr of pr.results) {
            scores.push({ scorer: `policy:${rr.id}`, passed: rr.passed, score: rr.passed ? 1 : 0, detail: rr.detail });
          }
        }
      } else {
        const res = await runStep({
          request: item.request,
          model: item.model,
          model_id: ev.model_id ?? undefined,
          keys: orgKeys,
        });
        output = res.output;

        if (!res.ok) {
          // The step never ran — a missing model key, a provider rate limit, a
          // 5xx. Scoring this as a normal failure meant a transient Groq rate
          // limit read as a behavioural regression and could flip a release
          // gate red. Record it plainly, and keep it out of pass_rate and out
          // of the gating denominator entirely.
          infraErrors++;
          scores = [{
            scorer: "infrastructure",
            passed: false,
            score: 0,
            detail: `Item could not be executed — not a test result: ${res.error ?? "unknown provider error"}`,
          }];
          await supabase.from("ad_eval_scores").insert({
            eval_run_id: evalId,
            item_id: item.id,
            passed: false,
            results: scores,
            output,
          });
          continue;
        }

        // Deterministic scorers first, then the async judge(s).
        scores = runDeterministicScorers(res.output, item.scorers);
        for (const cfg of item.scorers) {
          if (cfg.type === "llm_judge") {
            const hash = rubricHash(cfg.rubric, cfg.criteria);
            // The model THIS call will actually grade with — resolved up front so
            // getFewShotExamples can exclude corrections recorded under a
            // different judge identity (see calibration.ts's doc comment).
            const currentJudgeModel = pickJudgeModel(orgKeys);
            // Close the calibration loop: past human corrections for this exact
            // rubric are injected as few-shot examples, so a judge that was
            // corrected once keeps applying the correction going forward.
            const fewShot = ev.org_id ? await getFewShotExamples(ev.org_id, hash, 3, currentJudgeModel).catch(() => []) : [];
            const judgeResult = await runLlmJudge({
              output: res.output.text,
              rubric: cfg.rubric,
              threshold: cfg.threshold,
              criteria: cfg.criteria,
              samples: cfg.samples,
              keys: orgKeys,
              fewShot,
            });
            scores.push(judgeResult);
            if (ev.org_id) {
              await recordJudgeReview({
                orgId: ev.org_id,
                evalRunId: evalId,
                itemId: item.id,
                rubricHash: hash,
                rubricLabel: cfg.rubric.slice(0, 120),
                judgePassed: judgeResult.passed,
                judgeScore: judgeResult.score,
                judgeReason: judgeResult.detail ?? null,
                output: res.output.text,
                judgeModel: judgeResult.judgeModel ?? currentJudgeModel,
              });
            }
          }
        }
        // Policy-as-code: precise, deterministic rule checks.
        if (policy) {
          const { evaluatePolicy, inputTextOf } = await import("./policy");
          const pr = evaluatePolicy(policy as any, { output: res.output, inputText: inputTextOf(item.request) });
          for (const rr of pr.results) {
            scores.push({ scorer: `policy:${rr.id}`, passed: rr.passed, score: rr.passed ? 1 : 0, detail: rr.detail });
          }
        }
      }

      const itemOk = itemPassed(scores);
      if (itemOk) passed++;
      if (isTrustedForGating(item)) {
        gatingTotal++;
        if (itemOk) gatingPassed++;
      }

      await supabase.from("ad_eval_scores").insert({
        eval_run_id: evalId,
        item_id: item.id,
        passed: itemOk,
        results: scores,
        output,
      });
    }

    // pass_rate is over items that actually EXECUTED. Including items that
    // never reached the model would let an outage look like a quality drop.
    const scored = items.length - infraErrors;
    await supabase
      .from("ad_eval_runs")
      .update({
        status: "done",
        total: items.length,
        passed,
        pass_rate: scored > 0 ? passed / scored : 0,
        ended_at: new Date().toISOString(),
      })
      .eq("id", evalId);

    // Best-effort, separate write: gating_* are additive Phase-4 columns
    // (sql/add_adversarial_provenance.sql). A pre-migration database simply
    // won't have them — that must never break the main eval update above,
    // which every eval (adversarial or not) depends on.
    try {
      await supabase
        .from("ad_eval_runs")
        .update({
          gating_total: gatingTotal,
          gating_passed: gatingPassed,
          gating_pass_rate: gatingTotal > 0 ? gatingPassed / gatingTotal : null,
        })
        .eq("id", evalId);
    } catch { /* migration not applied yet */ }
  } catch (err) {
    await supabase
      .from("ad_eval_runs")
      .update({ status: "error", ended_at: new Date().toISOString() })
      .eq("id", evalId);
    throw err;
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */
