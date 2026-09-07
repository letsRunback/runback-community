-- Dedup log for the corpus-miner cron (web/app/api/cron/corpus-miner):
-- tracks which production failure signals (policy-blocked tool calls,
-- low-scoring eval items) have already been turned into an adversarial
-- test proposal, so the same failure isn't re-proposed on every run.
--
-- Cron-only bookkeeping — written and read exclusively via service_role
-- inside the cron itself, never through a user-facing route or the
-- tenant-scoped read client, so this follows create_ledger_tombstones.sql's
-- simpler single-file pattern (RLS + service_all only, no tenant_read) —
-- there is no user-facing read path this table needs to serve.
CREATE TABLE IF NOT EXISTS ad_corpus_mined_signals (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  signal_kind  text NOT NULL CHECK (signal_kind IN ('policy_block', 'low_score')),
  signal_ref   text NOT NULL,   -- ad_events.id for policy_block; ad_eval_scores.id for low_score
  dataset_id   uuid,            -- which dataset the resulting item(s) landed in, if generation succeeded
  mined_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_corpus_mined_signals_dedup
  ON ad_corpus_mined_signals(org_id, signal_kind, signal_ref);

ALTER TABLE ad_corpus_mined_signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_corpus_mined_signals FOR ALL TO service_role USING (true) WITH CHECK (true);
