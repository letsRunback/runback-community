-- Pairwise output comparison — is candidate output A or B better for the same
-- input, per item, rather than two independent pass/fail booleans (the
-- existing lib/eval/regression.ts diff). A comparison has no parent row of its
-- own: it's just two existing ad_eval_runs ids, exactly like the baseline/
-- candidate pair diffEvals() already treats that way.
CREATE TABLE IF NOT EXISTS ad_pairwise_verdicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  eval_run_a_id uuid NOT NULL REFERENCES ad_eval_runs(id) ON DELETE CASCADE,
  eval_run_b_id uuid NOT NULL REFERENCES ad_eval_runs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES ad_dataset_items(id) ON DELETE CASCADE,
  winner text NOT NULL CHECK (winner IN ('a', 'b', 'tie')),
  reason text,
  -- 'llm' verdicts can be overwritten by a human review of the same item —
  -- upserted on the same unique key, so the latest verdict always wins.
  source text NOT NULL DEFAULT 'llm' CHECK (source IN ('llm', 'human')),
  -- Which side was actually shown first to the judge, before any position-bias
  -- randomization was un-swapped for storage — kept for bias auditing.
  randomized boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz,
  UNIQUE (eval_run_a_id, eval_run_b_id, item_id)
);
ALTER TABLE ad_pairwise_verdicts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_pairwise_verdicts FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_pairwise_verdicts_runs_idx ON ad_pairwise_verdicts(eval_run_a_id, eval_run_b_id);
CREATE INDEX IF NOT EXISTS ad_pairwise_verdicts_org_idx ON ad_pairwise_verdicts(org_id);
