-- comparePairwise() had no guard against the judge grading a comparison where
-- one of the two candidate outputs was produced by the SAME model now judging
-- it — a known LLM-judge bias (self-preference). Detecting and blocking it
-- outright would mean silently picking a different judge model, a real
-- behavior change with cost/availability implications nobody asked for here.
-- Instead: record whether it happened, the same "bias-auditing metadata, not
-- silently hidden" treatment `randomized` already gets for position bias.
ALTER TABLE ad_pairwise_verdicts ADD COLUMN IF NOT EXISTS judge_is_candidate boolean NOT NULL DEFAULT false;
