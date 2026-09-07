# Tenant isolation in the database

Status: **step 2 rolled out and verified (2026-09-07).** `create_tenant_role.sql`
is applied, `SUPABASE_JWT_SECRET` is set, and reads on the migrated paths run as
the `tenant` role, which cannot bypass RLS. Verified in both directions against
the live database: a token for the owning org sees its rows, a token for a
foreign org sees zero. `/api/app/ledger` reports `tenant_isolation`, and
/security renders Live or Roadmap from that same value rather than a fixed
label, so the claim is computed per deployment instead of asserted.

Still true, and the reason this page keeps a Status line: **writes are
unchanged** and run as service_role, and only the migrated read paths are
covered (ad_runs, ad_events, ad_ledger*, ad_policies, ad_narratives,
ad_security_findings, ad_external_grants). Everything else still relies on
application-layer filtering plus the CI guards below.

One rollout note worth keeping, because it cost a production rollback: turning
this on the first time broke every tenant read. The cause was not the database —
policies and claim extraction were correct throughout — but
`createClient(url, token)`, which sets its second argument as the `apikey`
header. Supabase's gateway rejects an apikey that is not a project key before
PostgREST evaluates a policy, so reads failed with auth errors that the callers'
`.catch()` fallbacks turned into empty views. apikey identifies the project;
Authorization carries the tenant. `RUNBACK_TENANT_CLIENT=off` remains the kill
switch.

## The problem, stated precisely

Runback has one tenant boundary, and it is written in TypeScript.

Every query in the application goes through `getAdminClient()`, which
authenticates as Postgres' `service_role`. That role has `BYPASSRLS`. So row-
level security — however it is written — has no effect on any query the product
actually makes. Isolation holds because each call site remembers to write
`.eq("org_id", …)`.

That is not a hypothetical concern. This codebase has already shipped:

- a public run page calling `getRun(run_id)` with no org, serving any tenant's
  full trace to anonymous visitors by id;
- `modelDiff` selecting across every tenant's events and taking the first 2000;
- SCIM resolving a `userName` filter in JavaScript after a truncated read.

Each was one missing argument. Each passed code review, type-checking and the
whole test suite, because a missing filter is not a type error and an unscoped
read returns *more* data, never less. Two CI guards now scan the source for the
two worst shapes (`runIdTenantScope`, `publicRunScoping`), which is real
protection — but it is a linter, and a linter is not a boundary.

## What has been done

`sql/enable_rls_everywhere.sql` enables RLS on the sixteen tables that had none
and revokes the default `anon`/`authenticated` grants.

The hosted database turned out to have RLS on already — enabled out of band and
never recorded in a migration — so probing production with the anon key returned
empty and an insert returned `42501`.

Who was actually at risk is worth stating, because the obvious answer is wrong.
The bundled self-host was the *safest* of the three configurations:
`selfhost/init/90-grants.sql` gives anon `USAGE` and no table `SELECT`, with the
reasoning written down, and confines PostgREST to an internal Docker network.
The grants existed on **hosted Supabase**, which is why running the migration
there changed those tables from `200 []` to `401`. The genuinely exposed case
was narrower: self-hosting onto an *external* Supabase project, which inherits
Supabase's permissive defaults and gets only what our migrations declare.

`sql/revoke_anon_everywhere.sql` then extended the revoke across the whole
schema and flipped default privileges, so a new table is closed on creation
rather than closed later by a migration someone has to remember.

It deliberately stops short of org-predicated policies. Writing
`USING (org_id = …)` while every read still runs as `service_role` produces
policies that are never evaluated: the schema would *look* isolated and behave
exactly as before. A control that cannot fire is worse than a documented gap,
because the next reader believes it.

## Step 2, as built

`sql/create_tenant_role.sql` and `web/lib/supabase/tenant.ts` implement the
design below. What landed, and what it cost:

- **A `tenant` role**, `NOLOGIN NOBYPASSRLS`, granted to `authenticator` so
  PostgREST can `SET ROLE` into it after validating a token.
- **`current_org_id()`** reads the org from `request.jwt.claims`. Written
  against the GUC rather than Supabase's `auth.jwt()` so the same file works on
  a self-hosted PostgREST. `STABLE`, not `IMMUTABLE` — marking it immutable
  would let the planner cache it across requests, which would be a cross-tenant
  read created by an optimisation.
- **`tenant_read` policies** on eight tables, SELECT only. The predicate is
  generated per table because `org_id` is `uuid` on most and `text` on
  `ad_ledger_tombstones`; the first attempt failed to create with
  `operator does not exist: text = uuid`. The cast goes on the function side,
  never the column, or every check on `ad_events` would stop using its index.
- **No default privileges for `tenant`.** A new table must be granted
  explicitly, which forces the grant and its policy into the same migration and
  keeps new tables closed on creation.
- **`getTenantClient(orgId)`** mints a 60-second HS256 token carrying only
  `{role, org_id, iat, exp}` — no user, no session identity. It is a database
  credential scoped to one org, not something that speaks for a person.
- **`lib/runs.ts` migrated.** `listRuns`, `countRuns` and `getRun` now read
  through it whenever an org is known. The existing `.eq("org_id", …)` filters
  stay: correct anyway, they keep the plan tight, and they remain the only
  protection where the role is not configured.

### Rollout state

| | |
|---|---|
| Migration applied | ☐ `sql/create_tenant_role.sql` |
| `SUPABASE_JWT_SECRET` set in production | ☐ |
| `RUNBACK_TENANT_CLIENT` | unset = on; set to `off` to fall back |

Until the first two, `getTenantClient` returns the admin client and logs once
that isolation is *not* being enforced. `usedTenantRole` on the result reports
which path was taken, so a fallback cannot be mistaken for the real thing.

### Still to migrate

`lib/ledger.ts`, `lib/compliance.ts`, then the remaining read paths. Each needs
its queries checked against the policy set before switching, because a policy
that is too tight returns an empty result rather than an error — a mistake here
looks like missing data, not a failure.

## The original design: reads must stop running as service_role

The unit of work is not "write policies". It is "stop using the god client for
tenant data", after which policies become load-bearing.

### Mechanism

PostgREST already derives the current role and claims from the request JWT.
Supabase signs those with the project JWT secret, which the server holds.

1. **Mint a short-lived, org-scoped JWT per request.** Claims:
   `{ role: "tenant", org_id: "<uuid>", exp: now + 60s }`, signed with
   `SUPABASE_JWT_SECRET`. It never leaves the server and is not a session token.
2. **Add a `tenant` role** with no `BYPASSRLS`, granted `SELECT` (and `INSERT`/
   `UPDATE` where needed) on tenant tables.
3. **Write the policies** against the claim, not against application state:

   ```sql
   CREATE POLICY tenant_read ON ad_runs FOR SELECT TO tenant
     USING (org_id = (auth.jwt() ->> 'org_id')::uuid);
   ```

4. **Add `getTenantClient(orgId)`** alongside `getAdminClient()`, returning a
   supabase-js client with that JWT as its bearer.
5. **Migrate read paths one at a time**, starting with the ones a leak would
   hurt most: `lib/runs.ts`, `lib/ledger.ts`, `lib/compliance.ts`.

After (5), a call site that forgets `.eq("org_id", …)` returns **zero rows**
instead of everyone's. That is the whole point: the failure mode inverts from
silent over-disclosure to visible under-disclosure.

### What stays on service_role, and why

Not everything can or should move:

- **Ingest** resolves the org *from the API key* before it knows which tenant it
  is; it cannot present an org-scoped JWT it has not derived yet.
- **Cron jobs** operate across all orgs by design — retention, SIEM export,
  billing reconciliation.
- **Auth and org creation** run before an org context exists.
- **The admin audit log** must be writable by paths that are deliberately
  cross-tenant.

These should be *explicitly* service-role, ideally through a differently-named
accessor (`getPlatformClient()`) so that reaching for the unrestricted client is
a visible decision rather than the default import.

### Sequencing, and the risk

The migration is not atomic: a policy that is too strict returns empty results
rather than an error, so a mistake looks like missing data, not a failure. That
argues for:

- moving **one module at a time**, each behind its own deploy;
- a `RUNBACK_TENANT_CLIENT=off` kill switch that falls back to the admin client
  for a release or two;
- comparing row counts between the two clients in staging before switching.

Estimated cost: **3–5 days** for the mechanism plus the three highest-value
modules, and a longer tail for full coverage. Worth doing before the first
enterprise security review that asks how isolation survives an application bug,
which is the question this design answers and the current one does not.

## Why not just trust the guards

The source guards are good and should stay. They are also inherently partial:
they know about two functions and two tables, they match on syntax, and they
cannot see a query built dynamically. They make the common mistake loud. They do
not make the boundary exist.
