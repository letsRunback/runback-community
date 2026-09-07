-- Golden suite verification history — append-only, one row per (entry, run).
--
-- ad_golden.last_result/last_run_at are overwritten every time the suite runs,
-- so the only thing on record is "what happened most recently." That throws
-- away exactly the fact that makes an incident corpus a moat rather than a
-- dataset: an incident that has stayed fixed across N consecutive weekly runs,
-- through however many policy revisions happened in between, is a claim about
-- this org's own operating history with Runback — not something reconstructible
-- from a point-in-time export, because it requires having actually run the
-- suite continuously over that time, not just holding a copy of the data.
CREATE TABLE IF NOT EXISTS ad_golden_runs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id   uuid NOT NULL REFERENCES ad_golden(id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  ran_at     timestamptz NOT NULL DEFAULT now(),
  mode       text NOT NULL,           -- integrity | candidate
  model      text,                    -- candidate mode only
  result     text NOT NULL,           -- reproduced | diverged | recurs | changed | missing
  -- The active policy set's aggregate version at the moment of this run, so a
  -- "still fixed" streak is visibly a claim across policy revisions, not just
  -- across time — see policySnapshotDigest() in lib/golden.ts.
  policy_digest text
);
CREATE INDEX IF NOT EXISTS ad_golden_runs_entry ON ad_golden_runs(entry_id, ran_at DESC);
CREATE INDEX IF NOT EXISTS ad_golden_runs_org ON ad_golden_runs(org_id, ran_at DESC);

ALTER TABLE ad_golden_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS service_all ON ad_golden_runs;
CREATE POLICY service_all ON ad_golden_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
