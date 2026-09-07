-- Open a record in the system the customer already runs their risk process in.
--
-- WHY
-- Enterprises do not adopt another dashboard; they adopt something that shows
-- up in the queue they already work. A policy block that only exists in
-- Runback is a finding nobody is accountable for. The same block as a
-- ServiceNow incident assigned to a team has an owner, an SLA and an audit
-- trail their process already understands.
--
-- This is also the difference between being a tool and being infrastructure:
-- once agent governance findings flow into ServiceNow, removing Runback means
-- unpicking a workflow rather than cancelling a subscription.

CREATE TABLE IF NOT EXISTS ad_workflow_sinks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  kind         text NOT NULL CHECK (kind IN ('servicenow','jira','pagerduty','webhook')),
  endpoint     text NOT NULL,              -- instance/base URL; https only
  auth_cipher  text,                       -- AES-256-GCM; never the raw credential
  project_key  text,                       -- Jira project key / ServiceNow table
  enabled      boolean NOT NULL DEFAULT true,

  -- Which findings warrant a record. Ledger tampering and a silent critical
  -- agent are rare and severe; policy blocks are routine and would bury a queue,
  -- so they are opt-in and thresholded rather than on by default.
  on_ledger_tamper   boolean NOT NULL DEFAULT true,
  on_critical_gap    boolean NOT NULL DEFAULT true,
  on_policy_block    boolean NOT NULL DEFAULT false,
  policy_block_threshold integer NOT NULL DEFAULT 25,

  last_ok_at   timestamptz,
  last_error   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_workflow_sinks_org ON ad_workflow_sinks(org_id);

-- What we have already raised, so we do not raise it again.
--
-- Without this, a policy misconfiguration blocking every call would open a
-- ticket per occurrence and the integration would be switched off within a day
-- — the same outcome as never building it, reached more expensively and with
-- the customer's goodwill spent.
CREATE TABLE IF NOT EXISTS ad_workflow_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Stable identity of the FINDING, not the occurrence: e.g.
  -- "policy_block:refund-cap:support-agent" or "ledger_tamper:seq-15".
  dedupe_key   text NOT NULL,
  kind         text NOT NULL,              -- ledger_tamper | critical_gap | policy_block

  external_id  text,                       -- incident number / issue key, for the link back
  external_url text,
  occurrences  integer NOT NULL DEFAULT 1,
  first_raised timestamptz NOT NULL DEFAULT now(),
  last_seen    timestamptz NOT NULL DEFAULT now(),
  -- Cleared when the finding recurs after being closed, so a returning problem
  -- opens a fresh record rather than silently updating a closed one.
  closed_at    timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_workflow_records_key
  ON ad_workflow_records(org_id, dedupe_key) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS ad_workflow_records_recent
  ON ad_workflow_records(org_id, last_seen DESC);

ALTER TABLE ad_workflow_sinks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_workflow_records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_workflow_sinks' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_workflow_sinks FOR ALL TO service_role USING (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_workflow_records' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_workflow_records FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- Claim a finding. Returns whether this caller should actually raise a record.
-- Atomic so two concurrent detections cannot both open a ticket for one finding.
CREATE OR REPLACE FUNCTION claim_workflow_record(p_org uuid, p_key text, p_kind text)
RETURNS TABLE(should_raise boolean, occurrences integer) AS $$
DECLARE v_new boolean; v_count integer;
BEGIN
  INSERT INTO ad_workflow_records (org_id, dedupe_key, kind)
  VALUES (p_org, p_key, p_kind)
  ON CONFLICT (org_id, dedupe_key) WHERE closed_at IS NULL
  DO UPDATE SET occurrences = ad_workflow_records.occurrences + 1, last_seen = now()
  RETURNING (ad_workflow_records.occurrences = 1), ad_workflow_records.occurrences
  INTO v_new, v_count;

  RETURN QUERY SELECT v_new, v_count;
END $$ LANGUAGE plpgsql;
