-- Phase 4 — adversarial test generation. An LLM may PROPOSE a dataset item,
-- but it never grades its own work and it never counts toward a release-gate
-- decision until a human approves it. This gives dataset items a provenance +
-- approval trail distinct from production-captured items, and gives eval runs
-- a "gating" pass rate computed only from trusted items (captured, or
-- synthetic+approved) — separate from the "all items" pass rate shown for
-- review.

ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'captured';
ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS approval_status text;
ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS generated_rationale text;
ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS generated_from_run_id text;
ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS reviewed_by text;
ALTER TABLE ad_dataset_items ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;

-- source: 'captured' (snapshotted from a real production step) | 'synthetic'
-- (LLM-proposed, never actually run in production).
-- approval_status is meaningful ONLY for synthetic items: 'pending' | 'approved'
-- | 'rejected'. NULL for captured items (approval doesn't apply to them — they
-- are, by construction, real).
ALTER TABLE ad_dataset_items DROP CONSTRAINT IF EXISTS ad_dataset_items_source_check;
ALTER TABLE ad_dataset_items ADD CONSTRAINT ad_dataset_items_source_check
  CHECK (source IN ('captured', 'synthetic'));
ALTER TABLE ad_dataset_items DROP CONSTRAINT IF EXISTS ad_dataset_items_approval_check;
ALTER TABLE ad_dataset_items ADD CONSTRAINT ad_dataset_items_approval_check
  CHECK (approval_status IS NULL OR approval_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS ad_dataset_items_pending_review
  ON ad_dataset_items(dataset_id)
  WHERE source = 'synthetic' AND approval_status = 'pending';

-- ad_eval_runs: the "gating" subset excludes pending/rejected synthetic items,
-- so a proposed-but-unreviewed scenario can be scored and shown for review
-- without silently moving a release-gate pass rate before a human signs off.
ALTER TABLE ad_eval_runs ADD COLUMN IF NOT EXISTS gating_total integer NOT NULL DEFAULT 0;
ALTER TABLE ad_eval_runs ADD COLUMN IF NOT EXISTS gating_passed integer NOT NULL DEFAULT 0;
ALTER TABLE ad_eval_runs ADD COLUMN IF NOT EXISTS gating_pass_rate numeric;
