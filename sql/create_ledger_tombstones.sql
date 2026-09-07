-- Migration 55: ledger tombstones.
-- The audit ledger (ad_ledger) is append-only and never pruned, but retention
-- policy (web/lib/usage.ts enforceRetention) legitimately deletes old ad_runs
-- rows per GDPR Art.5 data minimisation. Before this table existed,
-- verifyLedger() had no way to distinguish "this run was deleted by an
-- attacker" from "this run was deleted by your own retention policy" --
-- both looked identical: a sealed ledger entry with no backing run, reported
-- as "tamper detected." That's a real false-positive against any customer
-- who has retention enabled at all, not just a demo-account quirk.
--
-- A tombstone is written (best-effort, before the delete) whenever retention
-- removes a run that has a sealed ledger entry. verifyLedger still fully
-- verifies chain linkage (entry_hash/prev_hash/leaf_hash, all stored on the
-- ledger row itself, independent of whether the run still exists) --
-- a tombstone does not let an attacker forge their way out of a broken
-- chain. It only explains why content re-derivation is impossible for that
-- one entry.
CREATE TABLE IF NOT EXISTS ad_ledger_tombstones (
  org_id     text NOT NULL,
  run_id     text NOT NULL,
  reason     text NOT NULL DEFAULT 'retention',
  pruned_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, run_id)
);
ALTER TABLE ad_ledger_tombstones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_ledger_tombstones FOR ALL TO service_role USING (true);
