-- Prove the tenant policies actually filter. Paste into the Supabase SQL editor
-- and run as-is — there is nothing to substitute.
--
-- The previous version asked you to replace ORG_A by hand, which failed with
-- `invalid input syntax for type uuid: "ORG_A"` the moment the placeholder
-- reached current_org_id(). A verification script that needs editing before it
-- runs is a script that gets edited wrongly, so this one picks the orgs itself.
--
-- Read-only. The role switch and the JWT claim are both SET LOCAL inside a DO
-- block, so they last exactly one statement and revert on their own — the
-- session cannot be left impersonating `tenant`.
--
-- What matters is the row `unscoped read sees N org(s)`. That query carries NO
-- org filter, which is precisely the bug this codebase has shipped three times.
-- It must see exactly one.

DROP TABLE IF EXISTS rls_check;
CREATE TEMP TABLE rls_check (step text, result text, verdict text);

DO $$
DECLARE
  org_a uuid;
  org_b uuid;
  run_b text;
  n_own int;
  n_orgs int;
  n_cross int;
  n_admin int;
  bypasses boolean;
  n_pol int;
  resolved uuid;
BEGIN
  -- ── Facts gathered as the owner, before any impersonation ────────────────
  SELECT rolbypassrls INTO bypasses FROM pg_roles WHERE rolname = 'tenant';
  IF bypasses IS NULL THEN
    INSERT INTO rls_check VALUES ('tenant role exists', 'NO', 'FAIL — run sql/create_tenant_role.sql');
    RETURN;
  END IF;
  INSERT INTO rls_check VALUES (
    'tenant bypasses RLS', bypasses::text,
    CASE WHEN bypasses THEN 'FAIL — no policy can ever fire' ELSE 'PASS' END);

  SELECT count(*) INTO n_pol FROM pg_policies
   WHERE schemaname='public' AND policyname='tenant_read';
  INSERT INTO rls_check VALUES (
    'tenant_read policies', n_pol::text,
    CASE WHEN n_pol >= 1 THEN 'PASS' ELSE 'FAIL — policies missing' END);

  SELECT org_id INTO org_a FROM ad_runs WHERE org_id IS NOT NULL
   GROUP BY org_id ORDER BY count(*) DESC LIMIT 1;
  IF org_a IS NULL THEN
    INSERT INTO rls_check VALUES ('orgs with runs', '0', 'SKIP — no data to verify against');
    RETURN;
  END IF;

  SELECT org_id INTO org_b FROM ad_runs
   WHERE org_id IS NOT NULL AND org_id <> org_a LIMIT 1;
  IF org_b IS NOT NULL THEN
    SELECT run_id INTO run_b FROM ad_runs WHERE org_id = org_b LIMIT 1;
    SELECT count(*) INTO n_admin FROM ad_runs WHERE run_id = run_b;
  END IF;

  -- ── Impersonate. SET LOCAL, so this reverts when the DO block ends ───────
  PERFORM set_config('request.jwt.claims', json_build_object('org_id', org_a)::text, true);
  SET LOCAL ROLE tenant;

  -- While impersonating, ONLY read into variables.
  --
  -- Writing to rls_check here fails with `permission denied for table
  -- rls_check`: the temp table belongs to the session owner and `tenant` holds
  -- SELECT on eight tables and nothing else. That is the role behaving exactly
  -- as intended, and it is why results are recorded after RESET ROLE below.
  resolved := public.current_org_id();
  SELECT count(*)               INTO n_own  FROM ad_runs;
  SELECT count(DISTINCT org_id) INTO n_orgs FROM ad_runs;
  IF run_b IS NOT NULL THEN
    SELECT count(*) INTO n_cross FROM ad_runs WHERE run_id = run_b;
  END IF;

  RESET ROLE;

  -- ── Results, recorded as the owner again ─────────────────────────────────

  -- The claim must resolve, or every check below is vacuously "isolated": a
  -- NULL org matches no row, so deny-everything looks identical to a working
  -- boundary.
  INSERT INTO rls_check VALUES (
    'current_org_id() resolves', coalesce(resolved::text, 'NULL'),
    CASE WHEN resolved = org_a THEN 'PASS'
         ELSE 'FAIL — claim not visible to the policy' END);
  INSERT INTO rls_check VALUES (
    'own-org read returns rows', n_own::text,
    CASE WHEN n_own > 0 THEN 'PASS' ELSE 'FAIL — policy too tight; this is an outage' END);

  -- THE assertion. No org filter in that query at all.
  INSERT INTO rls_check VALUES (
    'unscoped read sees N org(s)', n_orgs::text,
    CASE WHEN n_orgs = 1 THEN 'PASS — database enforced the boundary'
         ELSE 'FAIL — a query with no org filter saw more than one tenant' END);

  IF run_b IS NULL THEN
    INSERT INTO rls_check VALUES (
      'cross-tenant read', 'n/a',
      'SKIP — only one org holds runs, so this case is not exercised');
  ELSE
    INSERT INTO rls_check VALUES (
      'cross-tenant read by run_id', n_cross::text,
      CASE WHEN n_cross = 0 THEN 'PASS' ELSE 'FAIL — CROSS-TENANT LEAK' END);
    -- Proves the zero above means "denied", not "no such run".
    INSERT INTO rls_check VALUES (
      '…and that run exists for admin', n_admin::text,
      CASE WHEN n_admin = 1 THEN 'PASS' ELSE 'FAIL — control row missing; test proved nothing' END);
  END IF;
END $$;

-- Writes: the role holds SELECT and nothing else. Expected to raise
-- 42501 permission denied. Run separately — it aborts the statement.
--   SET LOCAL ROLE tenant; UPDATE ad_runs SET name = name;

SELECT * FROM rls_check;
