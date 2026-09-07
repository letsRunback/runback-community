-- Runs LAST. Belt-and-suspenders grants on the now-created tables, plus a seed
-- ingest key the smoke test (and you) can use immediately.
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
-- anon only needs USAGE on the schema so PostgREST can introspect it. Introspection
-- queries pg_catalog / information_schema — no per-table SELECT is required for that.
-- Granting SELECT on all tables would let unauthenticated REST callers read every row
-- even if the network boundary is breached. The web app uses the service_role JWT for
-- every server-side query; no legitimate path requires anon table-level access.
-- The PostgREST port (8000) is also confined to the 'backend' Docker network and is
-- unreachable from the host or external clients (defence-in-depth).
grant usage on schema public to anon;

-- Tell PostgREST to reload its schema cache now that all tables exist.
notify pgrst, 'reload schema';

-- No API key is seeded here. Generate a key via the Runback UI after first login,
-- or use the CLI: npx runback key create --plan free
-- A seed key with a publicly-known value would allow anyone who reads this
-- open-source repository to ingest data into your self-hosted instance.
