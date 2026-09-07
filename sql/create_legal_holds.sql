-- Legal hold: suspend retention deletion for runs that are subject to
-- litigation, a regulatory request, or an internal investigation.
--
-- Retention is otherwise unconditional — enforceRetention() prunes anything
-- past the plan's window. For a regulated customer that is a liability, not a
-- feature: destroying records that are under a preservation obligation is
-- spoliation, and "our vendor's retention policy deleted it" is not a defence.
-- Every enterprise evidence system has a hold; this is that.
--
-- A hold is a preservation instruction, so it is deliberately coarse: it is
-- better to keep too much than to reason cleverly about scope and get it wrong.

CREATE TABLE IF NOT EXISTS ad_legal_holds (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  reason      text NOT NULL,               -- matter reference, ticket, or instruction

  -- NULL agent_name = every run in the org. Otherwise only runs of that agent.
  agent_name  text,

  -- Optional lower bound; runs started before it are not covered. NULL = no bound.
  covers_from timestamptz,

  placed_by   text NOT NULL,               -- email, denormalised so it survives offboarding
  placed_at   timestamptz NOT NULL DEFAULT now(),
  released_by text,
  released_at timestamptz,                 -- NULL = still active

  CONSTRAINT ad_legal_holds_release_complete
    CHECK ((released_at IS NULL AND released_by IS NULL)
        OR (released_at IS NOT NULL AND released_by IS NOT NULL))
);

-- Retention consults active holds on every sweep, so this is the hot path.
CREATE INDEX IF NOT EXISTS ad_legal_holds_active
  ON ad_legal_holds(org_id) WHERE released_at IS NULL;

ALTER TABLE ad_legal_holds ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'ad_legal_holds' AND policyname = 'service_all') THEN
    CREATE POLICY "service_all" ON ad_legal_holds FOR ALL TO service_role USING (true);
  END IF;
END $$;
