-- Signed, append-only AI narrative log: an LLM-generated explanation of a
-- bisect divergence or a compliance control's evidence, sealed the moment
-- it's generated with a hash chain (tamper-evident history of narratives
-- themselves) plus a reference to the exact run digest it describes (so a
-- narrative can be proven to be ABOUT the run's current content, not a
-- since-altered or different version of it).
--
-- Deliberately NOT a new oracle-chain entry kind (see packages/replay/src/
-- cassette.ts's oracleEntryOf) — a narrative is a downstream analysis
-- artifact generated after the fact, often by a different model than the one
-- under audit, not a nondeterminism boundary the original run crossed.
-- Conflating "this run's environment interactions were faithfully captured"
-- with "this narrative honestly describes them" would weaken the first claim
-- for no verification benefit. This table is fully additive: it does not
-- read from, write to, or change the computation of any existing digest.
--
-- Chaining/signing happens in APPLICATION code (web/lib/narratives.ts), not
-- a Postgres function, because signing needs web/lib/signing.ts's Ed25519/
-- HMAC primitives (Node crypto) — entry_hash must exist before it can be
-- signed, so a DB-side "compute the chain link atomically" function (as
-- ledger_append uses for ad_ledger) can't also produce the signature in the
-- same statement. Instead: UNIQUE(org_id, prev_hash) is the safety net — a
-- concurrent writer racing on the same prev_hash gets a constraint violation
-- and retries (read the new tail, recompute, re-sign, re-insert), which is
-- MORE protection against a forked chain than ad_ledger_checkpoints'
-- sealCheckpoint() has today (no lock, no uniqueness — accepted precedent
-- for a low-frequency, user-triggered write path in this codebase).
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ad_narratives (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id         text   NOT NULL,
  subject        text   NOT NULL,        -- 'bisect' | 'model_diff' | 'compliance_control'
  subject_ref    text,                   -- e.g. ad_model_diffs.id, bisect firstBadIndex, or a regulatory control id
  content_digest text   NOT NULL,        -- the run's cassette_digest AT GENERATION TIME — read, never recomputed here
  model_id       text   NOT NULL,
  prompt         jsonb  NOT NULL,        -- canonicalized exactly as @runback/replay's canonical() serializes it
  output         jsonb  NOT NULL,
  payload_hash   text   NOT NULL,        -- sha256(canonical({org_id,run_id,subject,subject_ref,content_digest,model_id,prompt,output,prev_hash}))
  prev_hash      text   NOT NULL,        -- previous entry_hash for this org ('' for the first)
  entry_hash     text   NOT NULL,        -- sha256(prev_hash || payload_hash)
  signature      jsonb  NOT NULL,        -- Signature from web/lib/signing.ts, embedded verbatim ({alg,value,pubkey?})
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_narratives_org_prev ON ad_narratives(org_id, prev_hash);
CREATE INDEX IF NOT EXISTS ad_narratives_org_created ON ad_narratives(org_id, created_at);
CREATE INDEX IF NOT EXISTS ad_narratives_run ON ad_narratives(org_id, run_id);

-- Read-only helper: the current chain tail for an org, so application code
-- never has to hand-roll "SELECT ... ORDER BY created_at DESC LIMIT 1" (and
-- risk getting the ordering column wrong under future schema changes).
CREATE OR REPLACE FUNCTION narrative_tail(p_org uuid)
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT n.entry_hash FROM ad_narratives n WHERE n.org_id = p_org ORDER BY n.created_at DESC LIMIT 1),
    ''
  );
$$ LANGUAGE sql STABLE;
