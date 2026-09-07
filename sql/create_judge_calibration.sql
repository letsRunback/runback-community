-- Judge calibration — a human reviews a sample of real (non-demo) llm_judge
-- verdicts, agrees or corrects them, and corrections feed back into future
-- judge prompts as few-shot examples (lib/eval/calibration.ts's
-- getFewShotExamples, injected via lib/eval/judge.ts's fewShot param). No
-- separate "examples" table: a correction is just a row here where
-- human_passed != judge_passed, queried directly.
CREATE TABLE IF NOT EXISTS ad_judge_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  eval_run_id uuid NOT NULL REFERENCES ad_eval_runs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES ad_dataset_items(id) ON DELETE CASCADE,
  -- Identifies the judge config (rubric + criteria) this verdict came from —
  -- sha256, from lib/eval/judge.ts's rubricHash() — so calibration data
  -- generalizes across every dataset/eval that grades with the same rubric,
  -- not just this one eval run.
  rubric_hash text NOT NULL,
  rubric_label text,           -- truncated rubric text, denormalized for display only
  judge_passed boolean NOT NULL,
  judge_score numeric,
  judge_reason text,
  output_snippet text,         -- first ~500 chars of the graded output, denormalized so the review queue needs no join
  human_passed boolean,        -- null = not yet reviewed
  human_note text,
  reviewed_by text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (eval_run_id, item_id, rubric_hash)
);
ALTER TABLE ad_judge_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_judge_reviews FOR ALL TO service_role USING (true);
CREATE INDEX IF NOT EXISTS ad_judge_reviews_org_rubric_idx ON ad_judge_reviews(org_id, rubric_hash);
-- Fast "pending review" queue lookups: unreviewed rows for an org, newest first.
CREATE INDEX IF NOT EXISTS ad_judge_reviews_pending_idx ON ad_judge_reviews(org_id, created_at DESC) WHERE human_passed IS NULL;
