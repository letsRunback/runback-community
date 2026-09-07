-- SIEM export: forward the platform audit log to the customer's security
-- monitoring system (Splunk, Microsoft Sentinel, or any HTTPS collector).
--
-- Enterprises do not accept "log in to our dashboard to see who did what".
-- Access-control evidence has to land in the SOC alongside everything else, so
-- their detections, retention and audit obligations apply to it. A governance
-- product that keeps its audit trail hostage to its own UI is a silo.
--
-- One sink per org for now. Fan-out to several collectors is a real ask, but
-- the delivery cursor below is per-sink specifically so adding rows later needs
-- no migration of the delivery logic.

CREATE TABLE IF NOT EXISTS ad_siem_sinks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  kind         text NOT NULL CHECK (kind IN ('splunk_hec','sentinel','webhook')),
  endpoint     text NOT NULL,              -- collector URL; must be https
  token_cipher text,                       -- AES-256-GCM, never the raw token
  enabled      boolean NOT NULL DEFAULT true,

  -- Delivery watermark: the last admin-event seq confirmed accepted. Exporting
  -- resumes from here, so a failed run re-sends rather than skipping — an
  -- at-least-once gap in a security feed is worse than a duplicate, which the
  -- SIEM de-duplicates on event_id.
  cursor_seq   bigint NOT NULL DEFAULT -1,

  last_ok_at   timestamptz,
  last_error   text,                       -- surfaced in settings; a silently dead feed is the failure mode
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_siem_sinks_org ON ad_siem_sinks(org_id);

ALTER TABLE ad_siem_sinks ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_siem_sinks' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_siem_sinks FOR ALL TO service_role USING (true);
  END IF;
END $$;
