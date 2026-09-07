-- PLG lifecycle events. One row per org per event — unique constraint is the
-- deduplication layer. Best-effort: no RLS enforcement beyond service_role.
CREATE TABLE IF NOT EXISTS plg_events (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  event      text        NOT NULL,
  meta       jsonb       NOT NULL DEFAULT '{}',
  fired_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, event)
);
CREATE INDEX IF NOT EXISTS plg_events_org_idx ON plg_events(org_id, fired_at DESC);
