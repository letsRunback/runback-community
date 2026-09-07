-- Signed checkpoints for the ADMINISTRATIVE audit chain (ad_admin_events).
--
-- verifyAdminChain only re-derived hashes from stored content. That detects an
-- edit made by someone who does not also rewrite the chain — but anyone with
-- database write access can recompute every leaf_hash, prev_hash and
-- entry_hash after tampering, and the chain then verifies clean. The run
-- ledger already defends against exactly that with HMAC-signed checkpoints
-- (ad_ledger_checkpoints + checkpointTrusted in lib/ledgerCore.ts): the
-- signature is made with AUDIT_SIGNING_KEY, which is not in the database, so
-- an attacker confined to the DB cannot forge one.
--
-- /security describes the administrative log as tamper-evident on the same
-- terms as the run ledger. This is the missing half of that claim.
--
-- Mirrors ad_ledger_checkpoints deliberately: same column names, same
-- signature payload shape, so the two verification paths stay comparable.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ad_admin_checkpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq         bigint NOT NULL,             -- chain length sealed by this checkpoint
  head_hash   text   NOT NULL,             -- entry_hash of the last entry at seq
  signature   text,                        -- HMAC over org:seq:head (AUDIT_SIGNING_KEY)
  algorithm   text   NOT NULL DEFAULT 'sha256-chain',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_admin_ckpt_org ON ad_admin_checkpoints(org_id, seq DESC);

-- RLS here rather than in enable_rls_everywhere.sql: that file mounts at 75 in
-- docker-compose and this table is created at 99, so an ALTER there would run
-- against a table that does not exist yet and fail a fresh self-host init.
-- Tables created after the global pass carry their own, same as
-- add_narratives_rls.sql.
ALTER TABLE ad_admin_checkpoints ENABLE ROW LEVEL SECURITY;
