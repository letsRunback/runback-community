-- Org-wide tamper-evident ledger: an append-only, hash-chained log of every
-- run's attested digest. Altering, deleting, or inserting any past run breaks
-- the chain. Signed checkpoints anchor the head + a Merkle root for inclusion proofs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ad_ledger (
  org_id     uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq        bigint NOT NULL,              -- monotonic position within the org's ledger
  run_id     text   NOT NULL,
  leaf_hash  text   NOT NULL,              -- hash of the run's attested content
  prev_hash  text   NOT NULL,              -- previous entry_hash ('' for the first)
  entry_hash text   NOT NULL,              -- sha256(prev_hash || leaf_hash)
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_ledger_org_run ON ad_ledger(org_id, run_id);

CREATE TABLE IF NOT EXISTS ad_ledger_checkpoints (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq         bigint NOT NULL,             -- ledger length sealed by this checkpoint
  head_hash   text   NOT NULL,             -- chain head at seq
  merkle_root text   NOT NULL,             -- Merkle root over leaves [0, seq)
  signature   text,                        -- HMAC over org:seq:head:root (AUDIT_SIGNING_KEY)
  algorithm   text   NOT NULL DEFAULT 'sha256-chain+merkle',
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_ledger_ckpt_org ON ad_ledger_checkpoints(org_id, seq DESC);

-- Atomic append: serializes per org, assigns the next seq, links the chain.
-- Idempotent on (org_id, run_id) so retries never double-append or fork the chain.
CREATE OR REPLACE FUNCTION ledger_append(p_org uuid, p_run text, p_leaf text)
RETURNS TABLE(seq bigint, prev_hash text, entry_hash text) AS $$
DECLARE
  v_seq  bigint;
  v_prev text;
  v_entry text;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_org::text, 0));

  SELECT l.seq, l.prev_hash, l.entry_hash INTO v_seq, v_prev, v_entry
    FROM ad_ledger l WHERE l.org_id = p_org AND l.run_id = p_run;
  IF FOUND THEN
    RETURN QUERY SELECT v_seq, v_prev, v_entry; RETURN;
  END IF;

  SELECT COALESCE(MAX(l.seq), -1) INTO v_seq FROM ad_ledger l WHERE l.org_id = p_org;
  SELECT COALESCE(l.entry_hash, '') INTO v_prev
    FROM ad_ledger l WHERE l.org_id = p_org ORDER BY l.seq DESC LIMIT 1;
  v_prev := COALESCE(v_prev, '');
  v_seq  := v_seq + 1;
  v_entry := encode(digest(v_prev || p_leaf, 'sha256'), 'hex');

  INSERT INTO ad_ledger(org_id, seq, run_id, leaf_hash, prev_hash, entry_hash)
    VALUES (p_org, v_seq, p_run, p_leaf, v_prev, v_entry);

  RETURN QUERY SELECT v_seq, v_prev, v_entry;
END;
$$ LANGUAGE plpgsql;
