-- Feature #5 MVP — a real kill-switch, not just a dashboard alert.
--
-- One row per (org, agent). revoked=true means the next authorization check
-- (polled by the SDK's enforceToolCall pre-hook, cached with a short TTL —
-- see packages/sdk/src/collector.ts) blocks that agent's tool calls. Written
-- by the adversarial-guard cron (web/app/api/cron/adversarial-guard) when a
-- sampled replay diverges past threshold, or manually via the authorization
-- API.
--
-- Latency floor is the SDK's poll interval plus Vercel Cron's 1-minute
-- granularity — this is "revoked within the polling window", not
-- sub-second. Documented, not hidden: see docs/GUARD.md.
CREATE TABLE IF NOT EXISTS agent_authorization_state (
  org_id         uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  agent_name     text        NOT NULL,
  revoked        boolean     NOT NULL DEFAULT false,
  revoked_reason text,
  revoked_at     timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, agent_name)
);

ALTER TABLE agent_authorization_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'agent_authorization_state' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON agent_authorization_state FOR ALL TO service_role USING (true);
  END IF;
END $$;
