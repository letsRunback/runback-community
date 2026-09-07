-- External security-tool findings (Lakera, Cisco AI Defense, and similar
-- guardrail vendors) stamped into the customer's own audit trail. Deliberately
-- NOT part of the oracle chain (packages/replay/src/cassette.ts's
-- oracleEntryOf): a finding is a third party's OBSERVATION about a call
-- already made, often arriving asynchronously after the run — sometimes after
-- the run has already ended and its cassette digest is sealed. Folding it into
-- the digest would let an external webhook retroactively change a run's
-- replay identity, which is the exact integrity property Initiative 1's ADR
-- protects. Consistent with that precedent: tool/LLM events aren't
-- individually hash-chained either (only the run-level leaf_hash is, via
-- ad_ledger) — a finding gets the SAME evidentiary treatment as a narrative
-- (Initiative 1/3): its own hash chain + signature, referencing the run
-- without being part of its digest.
CREATE TABLE IF NOT EXISTS ad_security_findings (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id       text,                    -- which run this concerns, if any (free-form, no FK — matches ad_narratives.run_id)
  span_id      text,                    -- which specific event within the run, if the vendor can identify it
  vendor       text NOT NULL,           -- e.g. "lakera", "cisco-ai-defense"
  rule         text NOT NULL,           -- the vendor's own rule/policy identifier that fired
  severity     text NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high', 'critical')),
  verdict      text NOT NULL CHECK (verdict IN ('flagged', 'blocked', 'allowed')),
  detail       text NOT NULL,
  raw_finding  jsonb NOT NULL,          -- the vendor's full raw payload, verbatim, for evidentiary completeness
  payload_hash text NOT NULL,
  prev_hash    text NOT NULL,
  entry_hash   text NOT NULL,
  signature    jsonb NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS ad_security_findings_org_prev ON ad_security_findings(org_id, prev_hash);
CREATE INDEX IF NOT EXISTS ad_security_findings_org_created ON ad_security_findings(org_id, created_at);
CREATE INDEX IF NOT EXISTS ad_security_findings_org_run ON ad_security_findings(org_id, run_id);

ALTER TABLE ad_security_findings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_all" ON ad_security_findings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "tenant_read" ON ad_security_findings FOR SELECT TO tenant USING (org_id = current_org_id());
GRANT SELECT ON ad_security_findings TO tenant;

-- Read-only helper: the current chain tail for an org — same pattern as
-- narrative_tail() in sql/create_narratives.sql.
CREATE OR REPLACE FUNCTION security_finding_tail(p_org uuid)
RETURNS text AS $$
  SELECT COALESCE(
    (SELECT f.entry_hash FROM ad_security_findings f WHERE f.org_id = p_org ORDER BY f.created_at DESC LIMIT 1),
    ''
  );
$$ LANGUAGE sql STABLE;
