-- Governance coverage used one flat staleness threshold (14 days) for every
-- declared agent regardless of criticality. That's much too slow for the
-- agents where "stopped reporting" matters most: a critical agent silent for
-- two weeks is a very late warning if what actually happened is a bypass
-- (see packages/gateway's credential isolation work), not a genuine
-- two-week lull. Critical/high-criticality agents now go stale after a much
-- shorter, separately-configurable window (24h by default); standard/low
-- agents keep the original day-scale threshold, where a fast trigger would
-- just be noise from normal idle periods.
CREATE OR REPLACE FUNCTION agent_coverage(
  p_org                   uuid,
  p_stale_days            integer DEFAULT 14,
  p_stale_hours_critical  integer DEFAULT 24
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
      WHEN COALESCE(d.criticality, 'standard') IN ('critical', 'high')
           AND o.last_seen < now() - make_interval(hours => p_stale_hours_critical) THEN 'stale'
      WHEN COALESCE(d.criticality, 'standard') NOT IN ('critical', 'high')
           AND o.last_seen < now() - make_interval(days => p_stale_days)            THEN 'stale'
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
      WHEN COALESCE(d.criticality, 'standard') IN ('critical', 'high')
           AND o.last_seen < now() - make_interval(hours => p_stale_hours_critical) THEN 2
      WHEN COALESCE(d.criticality, 'standard') NOT IN ('critical', 'high')
           AND o.last_seen < now() - make_interval(days => p_stale_days)            THEN 2
      ELSE 3
    END,
    COALESCE(o.runs, 0) DESC;
$$;
