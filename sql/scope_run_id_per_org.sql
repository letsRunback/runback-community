-- Make (org_id, run_id) the identity of a run, instead of run_id alone.
--
-- WHY
-- ad_runs.run_id was globally UNIQUE, so run ids were a namespace shared by
-- every tenant. Two consequences:
--
--   1. Deleting a run frees its id for a different org to claim. verifyLedger()
--      then found a run for a sealed entry that belonged to someone else. That
--      happened for real when the demo workspace was migrated — three ids were
--      deleted from one org and re-seeded into another, and the old org's
--      ledger reported 24 of 27 entries retired instead of 27.
--
--   2. Any query filtering on run_id alone can read another tenant's row. The
--      application scopes its queries, but the schema did not require it, so
--      one missed filter was a cross-tenant read rather than an empty result.
--
-- Scoping verification (web/lib/ledger.ts) closed the first consequence. This
-- removes the class: after it, a run id is only meaningful inside its org, and
-- an unscoped lookup can no longer resolve to somebody else's data.
--
-- SAFE TO RE-RUN. Constraint names are looked up in pg_constraint rather than
-- assumed, because the defaults differ if a table was ever recreated by hand.
--
-- ORDER MATTERS: every foreign key pointing at ad_runs(run_id) must be dropped
-- before the unique constraint it depends on can go.

BEGIN;

-- ── 0. org_id must be NOT NULL before it can carry identity ─────────────────
-- Rows with no org cannot belong to a tenant and cannot be addressed by the
-- new key. Today these are two test artifacts (an OTel probe and a redaction
-- e2e run) whose api_key was deleted, so their org is unrecoverable — they are
-- not in any ledger. Deleting them cascades their events.
DELETE FROM ad_runs WHERE org_id IS NULL;

ALTER TABLE ad_runs ALTER COLUMN org_id SET NOT NULL;

-- ── 1. Drop dependants of the global unique ─────────────────────────────────
DO $$
DECLARE c record;
BEGIN
  -- Every FK whose referenced table is ad_runs (ad_events.run_id today, plus
  -- ad_runs.parent_run_id self-reference).
  FOR c IN
    SELECT con.conname, con.conrelid::regclass AS tbl
    FROM pg_constraint con
    WHERE con.contype = 'f' AND con.confrelid = 'ad_runs'::regclass
      AND con.conname NOT IN ('ad_events_org_run_fkey','ad_runs_org_parent_fkey')
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', c.tbl, c.conname);
  END LOOP;

  -- The global UNIQUE(run_id) itself.
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'ad_runs'::regclass
      AND con.contype IN ('u','p')
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM unnest(con.conkey) k
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
          = ARRAY['run_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE ad_runs DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

-- ── 2. The new identity ─────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_runs_org_run_key') THEN
    ALTER TABLE ad_runs ADD CONSTRAINT ad_runs_org_run_key UNIQUE (org_id, run_id);
  END IF;
END $$;

-- ── 3. ad_events carries its tenant so it can reference the composite key ───
ALTER TABLE ad_events ADD COLUMN IF NOT EXISTS org_id uuid;

UPDATE ad_events e
   SET org_id = r.org_id
  FROM ad_runs r
 WHERE e.run_id = r.run_id
   AND e.org_id IS DISTINCT FROM r.org_id;

-- Events whose run no longer exists were previously removed by the FK cascade;
-- any left behind are unreachable and cannot be attributed to a tenant.
DELETE FROM ad_events WHERE org_id IS NULL;

ALTER TABLE ad_events ALTER COLUMN org_id SET NOT NULL;

-- Span uniqueness (idempotent ingest — an SDK retry must not double-insert)
-- becomes org-scoped for the same reason run ids did.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'ad_events'::regclass
      AND con.contype = 'u'
      AND (SELECT array_agg(att.attname::text ORDER BY att.attname::text)
           FROM unnest(con.conkey) k
           JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = k)
          = ARRAY['run_id','span_id']::text[]
  LOOP
    EXECUTE format('ALTER TABLE ad_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_events_org_run_span_key') THEN
    ALTER TABLE ad_events ADD CONSTRAINT ad_events_org_run_span_key UNIQUE (org_id, run_id, span_id);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_events_org_run_fkey') THEN
    ALTER TABLE ad_events ADD CONSTRAINT ad_events_org_run_fkey
      FOREIGN KEY (org_id, run_id) REFERENCES ad_runs(org_id, run_id) ON DELETE CASCADE;
  END IF;
END $$;

-- The event rail always reads one run's events in order.
CREATE INDEX IF NOT EXISTS ad_events_org_run_seq_idx ON ad_events(org_id, run_id, seq);

-- ── 4. parent_run_id points at a run in the SAME org ────────────────────────
-- NULL parent_run_id leaves the constraint unenforced (MATCH SIMPLE), which is
-- what we want for top-level runs.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ad_runs_org_parent_fkey') THEN
    ALTER TABLE ad_runs ADD CONSTRAINT ad_runs_org_parent_fkey
      FOREIGN KEY (org_id, parent_run_id) REFERENCES ad_runs(org_id, run_id) ON DELETE SET NULL;
  END IF;
END $$;

COMMIT;
