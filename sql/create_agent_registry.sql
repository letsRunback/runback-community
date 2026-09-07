-- Declared agent inventory — the denominator for governance coverage.
--
-- WHY A REGISTRY AND NOT JUST OBSERVED RUNS
-- Runback can see every agent that reports to it. It cannot see the ones that
-- do not, and those are the entire point: "142 of 168 agents under governance"
-- is only meaningful if the 168 comes from the customer's own inventory rather
-- than from us counting what already talks to us. Derived from runs alone the
-- number is always 100%, which is worse than no number — it is a reassuring
-- one that cannot fall.
--
-- Reconciling a declared list against observed runs produces four states, and
-- three of them are findings:
--
--   covered      declared, reporting recently        — the good case
--   uninstrumented  declared, never seen             — the coverage gap
--   stale        declared, seen once, now silent     — capture broke, or the
--                                                      agent was retired without
--                                                      anyone saying so
--   undeclared   observed, never declared            — an AI system running in
--                                                      production that the risk
--                                                      register does not know
--                                                      about
--
-- The last one tends to matter most to the person buying this. Shadow AI is
-- hard to find precisely because nobody wrote it down, and an agent that is
-- reporting to Runback while absent from the inventory is self-evidence.

CREATE TABLE IF NOT EXISTS ad_agent_registry (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,

  -- Matches ad_runs.name. That is the only join key an SDK caller controls, so
  -- it is what the inventory has to be keyed on.
  name        text NOT NULL,

  owner       text,                       -- accountable person or team
  criticality text NOT NULL DEFAULT 'standard'
              CHECK (criticality IN ('critical','high','standard','low')),
  system_of_record text,                  -- e.g. the CMDB or risk-register id

  declared_at timestamptz NOT NULL DEFAULT now(),
  declared_by text,
  -- Retired rather than deleted: an agent that existed during an audited period
  -- must stay explicable afterwards.
  retired_at  timestamptz,
  retired_by  text
);

CREATE UNIQUE INDEX IF NOT EXISTS ad_agent_registry_org_name
  ON ad_agent_registry(org_id, name);
CREATE INDEX IF NOT EXISTS ad_agent_registry_active
  ON ad_agent_registry(org_id) WHERE retired_at IS NULL;

ALTER TABLE ad_agent_registry ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_agent_registry' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_agent_registry FOR ALL TO service_role USING (true);
  END IF;
END $$;

-- Reconcile the declared inventory against what has actually reported.
--
-- Full outer join so undeclared agents surface as first-class rows rather than
-- being silently excluded — an inventory report that can only tell you about
-- things already on the inventory is circular.
CREATE OR REPLACE FUNCTION agent_coverage(
  p_org        uuid,
  p_stale_days integer DEFAULT 14
)
RETURNS TABLE(
  name         text,
  status       text,
  owner        text,
  criticality  text,
  runs         bigint,
  last_seen    timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH declared AS (
    SELECT r.name, r.owner, r.criticality
    FROM ad_agent_registry r
    WHERE r.org_id = p_org AND r.retired_at IS NULL
  ),
  observed AS (
    SELECT a.name, count(*)::bigint AS runs, max(a.started_at) AS last_seen
    FROM ad_runs a
    WHERE a.org_id = p_org AND a.name IS NOT NULL
    GROUP BY a.name
  )
  SELECT
    COALESCE(d.name, o.name)                                   AS name,
    CASE
      WHEN d.name IS NULL                                      THEN 'undeclared'
      WHEN o.name IS NULL                                      THEN 'uninstrumented'
      WHEN o.last_seen < now() - make_interval(days => p_stale_days) THEN 'stale'
      ELSE 'covered'
    END                                                        AS status,
    d.owner                                                    AS owner,
    COALESCE(d.criticality, 'standard')                        AS criticality,
    COALESCE(o.runs, 0)                                        AS runs,
    o.last_seen                                                AS last_seen
  FROM declared d
  FULL OUTER JOIN observed o ON o.name = d.name
  ORDER BY
    -- Findings first; the good case does not need attention.
    CASE
      WHEN d.name IS NULL THEN 0
      WHEN o.name IS NULL THEN 1
      WHEN o.last_seen < now() - make_interval(days => p_stale_days) THEN 2
      ELSE 3
    END,
    COALESCE(o.runs, 0) DESC;
$$;
