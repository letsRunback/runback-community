-- PostgREST/Supabase-compatible roles. Runs FIRST, before the app migrations,
-- so their `... TO service_role` policies resolve and future tables inherit the
-- service_role grant automatically.
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;          -- full access, skips RLS
create role authenticator noinherit nologin; -- password and LOGIN granted by 05-set-authenticator-password.sh (no known placeholder is ever valid)

grant anon to authenticator;
grant authenticated to authenticator;
grant service_role to authenticator;

grant usage on schema public to anon, authenticated, service_role;

-- Tables the app migrations create next (as superuser) auto-grant to service_role.
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant all on sequences to service_role;
alter default privileges in schema public grant all on functions to service_role;
-- anon only needs schema USAGE for PostgREST introspection; SELECT on app tables is
-- granted explicitly per table in later migration files, not by default privilege.
