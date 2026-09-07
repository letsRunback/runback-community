-- Calibration data (ad_judge_reviews) was keyed only by rubric_hash, never by
-- which judge model actually produced the verdict. A silent provider
-- checkpoint swap (or an org changing RUNBACK_JUDGE_MODEL / their BYOK
-- provider key) would keep applying few-shot corrections gathered under a
-- DIFFERENT judge's behavior with nothing surfacing that it happened —
-- lib/eval/calibration.ts's getFewShotExamples now filters on this column.
-- Null on existing rows (recorded before this column existed): treated as
-- "unknown, still usable" rather than discarded outright — see the comment
-- at getFewShotExamples's call site for why that's the safer default.
ALTER TABLE ad_judge_reviews ADD COLUMN IF NOT EXISTS judge_model text;
