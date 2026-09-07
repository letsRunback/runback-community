/**
 * The seam between Community ingest and the commercially-licensed alerting
 * engine ("alerting" in lib/entitlements.ts).
 *
 * lib/ingest.ts — the core capture path, Community — fired alert rules by
 * importing lib/enterprise/alerts directly, which meant ingest couldn't
 * compile without the licensed module present. It now depends only on this
 * slot, which lib/enterprise/alerts fills on import.
 *
 * The fallback is a silent no-op, and that is the CORRECT behaviour here
 * rather than a compromise: a Community deployment has no alert rules to
 * evaluate (the feature is absent, not broken), so having nothing to fire is
 * the honest outcome. Contrast lib/enterprise/... seams whose absence would
 * silently degrade a recorded artefact — those throw. Nothing is recorded
 * here; alerting is a notification side effect.
 */

export interface RunAlertContext {
  run_id: string;
  name: string;
  status: string;
}

type AlertEvaluator = (orgId: string | null, run: RunAlertContext) => Promise<unknown>;

let evaluator: AlertEvaluator | null = null;

/** Called by lib/enterprise/alerts at import time. Not part of the public API. */
export function registerAlertEvaluator(fn: AlertEvaluator): void {
  evaluator = fn;
}

/** True when the alerting engine is present in this build. */
export function alertingAvailable(): boolean {
  return evaluator !== null;
}

/**
 * Evaluate this org's alert rules against a finished run. Resolves without
 * doing anything when alerting isn't part of the build. Never throws — a
 * failing notification must not fail an ingest that already persisted.
 */
export async function evaluateRunAlerts(orgId: string | null, run: RunAlertContext): Promise<void> {
  if (!evaluator) return;
  try {
    await evaluator(orgId, run);
  } catch {
    /* best-effort, exactly as the direct call site was */
  }
}
