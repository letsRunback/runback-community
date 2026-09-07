CREATE TABLE approvals (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  run_id        TEXT        NOT NULL,
  span_id       TEXT,
  policy_name   TEXT,
  rule_id       TEXT,
  rule_desc     TEXT,
  context       JSONB       NOT NULL DEFAULT '{}',
  status        TEXT        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected','timed_out')),
  decision_note TEXT,
  decided_by    TEXT,
  decided_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_approvals_org_status  ON approvals(org_id, status, created_at DESC);
CREATE INDEX idx_approvals_run         ON approvals(run_id);
CREATE INDEX idx_approvals_expires     ON approvals(expires_at) WHERE status = 'pending';
