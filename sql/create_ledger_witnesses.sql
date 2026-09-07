-- External witnesses for ledger checkpoints (RFC 3161 time-stamp tokens).
--
-- The ledger was self-attested: Runback signs each checkpoint with
-- AUDIT_SIGNING_KEY and Runback holds that key, so anyone with database access
-- AND the key could rewrite history, re-seal, and pass verification. Every
-- existing check answers "did someone else alter this"; none answered "did the
-- operator alter this".
--
-- A Time-Stamp Authority signs "this hash existed at this time" using a
-- certificate we do not control. We cannot backdate one. Rewriting the chain
-- changes the head, and no TSA will issue a token for the new head dated
-- earlier — so retroactive rewriting becomes detectable by a third party rather
-- than by us.
--
-- The token is stored verbatim, exactly as the authority returned it. It is
-- deliberately opaque to this system: verification is `openssl ts -verify`,
-- a tool that predates us and that we do not ship. A customer checking our
-- tamper-evidence should not have to run our verifier to do it.

CREATE TABLE IF NOT EXISTS ad_ledger_witnesses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid   NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  seq          bigint NOT NULL,          -- the checkpoint witnessed
  tsa          text   NOT NULL,          -- which authority
  imprint      text   NOT NULL,          -- sha256(org:seq:head:root) the TSA signed
  token_b64    text   NOT NULL,          -- RFC 3161 TimeStampToken, DER, base64
  requested_at timestamptz NOT NULL DEFAULT now(),
  -- One receipt per authority per checkpoint. Re-witnessing the same checkpoint
  -- is idempotent rather than accumulating duplicates.
  UNIQUE (org_id, seq, tsa)
);

CREATE INDEX IF NOT EXISTS ad_ledger_witness_org ON ad_ledger_witnesses(org_id, seq DESC);

ALTER TABLE ad_ledger_witnesses ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname='public' AND tablename='ad_ledger_witnesses' AND policyname='service_all'
  ) THEN
    CREATE POLICY "service_all" ON ad_ledger_witnesses
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

DO $$
BEGIN
  EXECUTE 'REVOKE ALL ON ad_ledger_witnesses FROM anon';
  EXECUTE 'REVOKE ALL ON ad_ledger_witnesses FROM authenticated';
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Readable through the org-scoped tenant role, like the rest of the ledger.
-- A customer must be able to fetch their own receipts to hand to an auditor.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='tenant') THEN
    EXECUTE 'GRANT SELECT ON ad_ledger_witnesses TO tenant';
    EXECUTE 'DROP POLICY IF EXISTS tenant_read ON ad_ledger_witnesses';
    EXECUTE 'CREATE POLICY tenant_read ON ad_ledger_witnesses FOR SELECT TO tenant '
         || 'USING (org_id = public.current_org_id())';
  END IF;
END $$;
