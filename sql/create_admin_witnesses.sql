-- External witnessing and public publication for the ADMINISTRATIVE audit
-- chain, bringing it to the same standard as the run ledger.
--
-- ad_admin_checkpoints already anchors the chain against AUDIT_SIGNING_KEY,
-- which defeats an attacker confined to the database. It does NOT defeat one
-- who also holds that key: they could re-sign a rewritten chain and it would
-- verify. RFC 3161 time-stamps close that, because a third party attests the
-- head existed at a time — we cannot backdate someone else's signature.
--
-- WHY A SEPARATE WITNESS TABLE rather than reusing ad_ledger_witnesses: that
-- table is UNIQUE (org_id, seq, tsa) and the two chains have INDEPENDENT
-- sequences. An org with a run-ledger checkpoint at seq 5 and an admin
-- checkpoint at seq 5 would collide on the same key and silently overwrite one
-- receipt with the other — attaching the run ledger's proof to the admin
-- chain, which is worse than having no proof at all.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS ad_admin_witnesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq          bigint NOT NULL,          -- the admin checkpoint witnessed
  tsa          text   NOT NULL,
  imprint      text   NOT NULL,          -- sha256(seq:head:root) the TSA signed
  token_b64    text   NOT NULL,          -- RFC 3161 TimeStampToken, DER, base64
  requested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, seq, tsa)
);
CREATE INDEX IF NOT EXISTS ad_admin_witness_org ON ad_admin_witnesses(org_id, seq DESC);
ALTER TABLE ad_admin_witnesses ENABLE ROW LEVEL SECURITY;

-- A SECOND opaque identifier per org, for publishing admin-chain heads to the
-- public transparency feed.
--
-- Not the org's existing log_id: that would let any observer correlate the two
-- chains and read one org's admin-action count against its run count. Separate
-- random ids keep each chain's publication unlinkable, which is the same
-- privacy rule create_transparency_log.sql already applies to org_id itself.
--
-- Additive column only. The published row shape is unchanged, so the feed's
-- existing hash chain still verifies — the rows are hash-linked, and altering
-- their shape would invalidate every entry already published.
ALTER TABLE ad_transparency_ids
  ADD COLUMN IF NOT EXISTS admin_log_id text UNIQUE;
