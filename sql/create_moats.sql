-- ── Moat 5: Policy library / marketplace ────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_policy_templates (
  id          text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        text        NOT NULL,
  description text        NOT NULL,
  category    text        NOT NULL, -- 'safety'|'compliance'|'cost'|'quality'|'security'|'custom'
  tags        text[]      NOT NULL DEFAULT '{}',
  rules       jsonb       NOT NULL DEFAULT '[]',
  example     jsonb,                -- illustrative trigger scenario
  author      text        NOT NULL DEFAULT 'runback', -- 'runback' | org name
  org_id      uuid        REFERENCES orgs(id) ON DELETE CASCADE, -- null = built-in
  is_public   boolean     NOT NULL DEFAULT false,
  use_count   integer     NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_policy_templates_public ON ad_policy_templates(category, use_count DESC) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS ad_policy_templates_org    ON ad_policy_templates(org_id) WHERE org_id IS NOT NULL;

-- ── Moat 6: Semantic model diff cache ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_model_diffs (
  id                text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id            uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  model_a           text        NOT NULL,
  model_b           text        NOT NULL,
  window_days       integer     NOT NULL DEFAULT 30,
  run_count         integer     NOT NULL DEFAULT 0,
  diverged_count    integer     NOT NULL DEFAULT 0,
  divergence_rate   numeric(6,4),
  critical_count    integer     NOT NULL DEFAULT 0,
  policy_impact     boolean     NOT NULL DEFAULT false,
  examples          jsonb       NOT NULL DEFAULT '[]',
  status            text        NOT NULL DEFAULT 'complete',
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, model_a, model_b, window_days)
);
CREATE INDEX IF NOT EXISTS ad_model_diffs_org ON ad_model_diffs(org_id, created_at DESC);

-- ── Moat 3: Model upgrade gate results ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_upgrade_gates (
  id              text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id          uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  from_model      text        NOT NULL,
  to_model        text        NOT NULL,
  total_tests     integer     NOT NULL DEFAULT 0,
  passed          integer     NOT NULL DEFAULT 0,
  failed          integer     NOT NULL DEFAULT 0,
  changed         integer     NOT NULL DEFAULT 0,
  pass_rate       numeric(6,4),
  verdict         text        NOT NULL DEFAULT 'pending', -- 'pass'|'fail'|'warning'|'pending'
  results         jsonb       NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ad_upgrade_gates_org ON ad_upgrade_gates(org_id, created_at DESC);

-- ── Moat 7: Cost attribution cache ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_cost_cache (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id        uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  window_days   integer     NOT NULL DEFAULT 30,
  report        jsonb       NOT NULL DEFAULT '{}',
  generated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, window_days)
);

-- ── Moat 2: Fleet benchmark percentiles ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_benchmarks (
  id            text        PRIMARY KEY DEFAULT gen_random_uuid()::text,
  org_id        uuid        NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  metric        text        NOT NULL,
  agent_class   text        NOT NULL DEFAULT '*',
  value         numeric     NOT NULL,
  percentile    integer,
  fleet_median  numeric,
  fleet_p90     numeric,
  window_days   integer     NOT NULL DEFAULT 30,
  computed_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, metric, agent_class, window_days)
);
CREATE INDEX IF NOT EXISTS ad_benchmarks_org ON ad_benchmarks(org_id, metric);
