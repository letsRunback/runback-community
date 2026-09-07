CREATE TABLE incidents (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id         TEXT        NOT NULL,
  run_name       TEXT,
  title          TEXT        NOT NULL,
  status         TEXT        NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open','investigating','remediated','closed')),
  severity       TEXT        NOT NULL DEFAULT 'medium'
                             CHECK (severity IN ('low','medium','high','critical')),
  root_cause     TEXT,
  remediation    TEXT,
  golden_run_id  TEXT,
  timeline       JSONB       NOT NULL DEFAULT '[]',
  created_by     TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at      TIMESTAMPTZ
);

CREATE INDEX idx_incidents_org_status ON incidents(org_id, status, created_at DESC);
CREATE INDEX idx_incidents_run        ON incidents(run_id);
