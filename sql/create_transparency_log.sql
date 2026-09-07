-- Public transparency log for ledger checkpoints.
--
-- ── What the time-stamps could not do ───────────────────────────────────────
-- RFC 3161 witnessing proves a checkpoint head existed by a given time, so we
-- cannot rewrite history and backdate the proof. It does NOT stop us
-- equivocating: sealing two divergent chains for the same org and honestly
-- time-stamping both, then showing each party a different one. Nothing in a
-- timestamp reveals that a second history exists.
--
-- Catching that needs somewhere all checkpoints are visible together, so any
-- observer can spot two different heads claimed for the same (log, seq). That
-- is what this table feeds.
--
-- ── Privacy ────────────────────────────────────────────────────────────────
-- The feed is public, so it must reveal nothing about content or customers. It
-- publishes only:
--   log_id  — a RANDOM per-org identifier with no derivation from org_id. Not a
--             hash of it: a hash is a guess-check oracle for anyone who obtains
--             an org id, and org ids appear in URLs and support tickets.
--   seq, head_hash, merkle_root — hashes of hashes. No run content, no names.
--
-- ── The feed is itself a chain ─────────────────────────────────────────────
-- Each row links to the previous by hash, so the published log cannot be
-- silently rewritten either. An observer who archived any earlier feed head can
-- prove the current feed still extends it.

CREATE TABLE IF NOT EXISTS ad_transparency_log (
  seq          bigserial PRIMARY KEY,      -- position in the PUBLIC log
  log_id       text   NOT NULL,            -- opaque per-org identifier
  ckpt_seq     bigint NOT NULL,            -- the org's checkpoint sequence
  head_hash    text   NOT NULL,
  merkle_root  text   NOT NULL,
  prev_hash    text   NOT NULL,            -- previous row's entry_hash ('' at genesis)
  entry_hash   text   NOT NULL,            -- sha256(prev || canonical(row))
  published_at timestamptz NOT NULL DEFAULT now(),
  -- One published entry per org checkpoint. Re-publishing is idempotent, and a
  -- second row for the same (log_id, ckpt_seq) with a DIFFERENT head is exactly
  -- the equivocation this exists to make impossible to hide — the constraint
  -- means it cannot be inserted quietly.
  UNIQUE (log_id, ckpt_seq)
);

CREATE INDEX IF NOT EXISTS ad_transparency_seq ON ad_transparency_log(seq);

-- Per-org opaque identifier. Random, not derived.
CREATE TABLE IF NOT EXISTS ad_transparency_ids (
  org_id uuid PRIMARY KEY REFERENCES orgs(id) ON DELETE CASCADE,
  log_id text NOT NULL UNIQUE,
  -- Publishing is opt-out per org: a customer who does not want even an opaque
  -- record of "some org sealed a checkpoint" can decline without losing the
  -- ledger itself.
  published boolean NOT NULL DEFAULT true
);

ALTER TABLE ad_transparency_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_transparency_ids ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ad_transparency_log','ad_transparency_ids'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename=t AND policyname='service_all'
    ) THEN
      EXECUTE format('CREATE POLICY "service_all" ON %I FOR ALL TO service_role USING (true) WITH CHECK (true)', t);
    END IF;
    BEGIN
      EXECUTE format('REVOKE ALL ON %I FROM anon', t);
      EXECUTE format('REVOKE ALL ON %I FROM authenticated', t);
    EXCEPTION WHEN undefined_object THEN NULL;
    END;
  END LOOP;
END $$;

-- Note: the log is served publicly by an application route, NOT by granting
-- anon direct table access. The route decides what is published; the table
-- stays closed, so a future column cannot become public by accident.
