# EAAPL Compliance-Evidence Integration — Spec

> How Runback exposes a read-only compliance summary so EAAPL can back its APRA CPS 230 /
> EU AI Act evidence pack with verified data instead of a self-reported checkbox. This is a
> new, narrow read surface on top of data Runback already has — no new engine, no new capture
> tier, and no change to what ships to a Runback customer's own dashboard.

---

## 0. Where we actually are (honest map)

Runback already computes or stores everything this integration needs:

| Data | Source today |
|---|---|
| Signed audit records per run | `web/lib/audit.ts` (`buildAuditRecord`, hash-chained events + HMAC-SHA256) |
| Whether a run has a signed record | `ad_runs` + `audit.ts` (derivable, not currently aggregated) |
| CI gate pass/fail history | `packages/replay/src/gate.ts` output, surfaced per-run, not aggregated org-wide |
| Alert rules / delivery history | `sql/create_alerts.sql` (`alert_rules`, `alert_deliveries`), `web/lib/alerts.ts` |
| Retention policy | `web/lib/entitlements.ts` (`PLAN_LIMITS[plan].retention`) |
| SSO status | `orgs.sso_enabled` (`sql/create_sso.sql`) |

**The gap is aggregation and a narrower auth boundary, not missing data.** Nothing here requires
a new capture path — it's a read model over existing tables, exposed through a key scope that
doesn't already exist.

---

## 1. New key scope: `compliance_read`

Today `api_keys` gate ingest (write) and, implicitly, whatever the dashboard session allows
(full read as the authenticated org member). Neither is right to hand to a third party.

Add a new key type:

```sql
-- extends existing api_keys table (sql/create_api_keys.sql)
alter table api_keys add column if not exists scope text not null default 'ingest';
-- scope in ('ingest', 'compliance_read')
```

- `ingest` — existing behavior, unchanged. Used by the SDK/OTel exporter.
- `compliance_read` — **new**, read-only, resolves to exactly one route
  (`/api/v1/compliance/evidence-summary`) and nothing else. No dashboard session, no run
  content, no other API route.

Issued from `/app/settings/compliance-key` (new page, Enterprise-gated like SSO — this is a
governance feature, not a free-tier one): generate, label ("EAAPL — prod"), revoke. Mirrors the
existing API-key UI pattern, doesn't need new components.

**Why a new scope instead of reusing the ingest key:** the ingest key is a write credential an
agent process holds; handing it to a third-party SaaS for read purposes is a privilege
mismatch. A dedicated read-only, single-route scope means a leaked EAAPL-side key can only ever
disclose aggregate compliance numbers — never ingest a forged run or read run content.

---

## 2. The endpoint

```
GET /api/v1/compliance/evidence-summary
Authorization: Bearer <compliance_read key>
```

```jsonc
{
  "org": { "id": "org_...", "plan": "enterprise" },
  "period": { "from": "2026-06-01T00:00:00Z", "to": "2026-07-01T00:00:00Z" },
  "audit_coverage_pct": 97.4,          // % of ALL ingested runs with a signed audit record
  "retention_days": 90,
  "sso_enabled": true,
  "ci_gate": {
    "enabled": true,
    "pass_rate_30d": 0.93,
    "last_run_at": "2026-06-29T14:02:00Z"
  },
  "alerting": {
    "enabled": true,
    "rules_count": 4,
    "deliveries_30d": 11
  },
  "sample": [
    { "run_id": "run_...", "digest": "sha256:9c4a…", "signed_at": "2026-06-28T…", "verify_url": "https://runback.dev/api/audit/verify?run=run_..." }
  ]
}
```

**Definitions that matter (don't relitigate these later — they're the honesty boundary):**
- `audit_coverage_pct` = signed-record runs ÷ **all ingested runs** in the period, not just
  runs that hit the CI gate. The harder, more honest number.
- `sample` is capped (proposed: 10 runs) and rotates — enough for an auditor to spot-check,
  not enough to reconstruct usage volume precisely.
- No field in this payload is derived from prompt content, tool arguments, or tool output.
  Only counts, booleans, rates, and timestamps, plus digests that are already meant to be
  public/verifiable (`/api/audit/verify` requires no account today).

**Implementation:** a new route handler in `web/app/api/v1/compliance/evidence-summary/route.ts`,
authenticated via the new scope check (reuse `resolveApiKey`, extend to branch on `scope`),
aggregating `ad_runs`/`alert_deliveries`/`orgs` for the requesting org — no new tables on the
Runback side beyond the `scope` column above.

**Rate limit:** same tiered limiter already used for `/v1/*`-style routes; this is a low-volume,
polled endpoint (daily/hourly at most), so a generous ceiling (e.g. 24 requests/day) is enough
to prevent abuse without needing new infra.

---

## 3. EAAPL side

New integration type on the existing pattern (EAAPL already has GitHub/webhook-style
integrations for adoption tracking):

```sql
-- new table
create table integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  provider text not null,              -- 'runback' (extensible later)
  api_key text not null,               -- the compliance_read key, encrypted at rest
  connected_at timestamptz not null default now(),
  last_synced_at timestamptz
);

create table evidence_records (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  control_id text not null,            -- e.g. 'eu-ai-act-art12-logging'
  framework text not null,             -- 'EU AI Act' | 'APRA CPS 230' | ...
  source text not null,                -- 'runback' | 'self_reported' | ...
  status text not null,                -- 'verified' | 'partial' | 'stale' | 'missing'
  evidence_ref text,                   -- verify_url from the Runback sample
  collected_at timestamptz not null default now()
);
```

A cron job (EAAPL already runs scheduled jobs under `app/api/cron`) pulls each connected org's
`evidence-summary` on a schedule, maps the payload onto rows via the table in the integration
page/spec below, and writes `evidence_records`. The `tracker/apra-export` UI reads both
self-reported adoption and `evidence_records`, badging the latter "verified."

**Mapping (fixed, not configurable per-customer — keep the mapping honest and auditable):**

| Runback field | `control_id` | `framework` |
|---|---|---|
| `audit_coverage_pct`, `retention_days` | `automatic-event-logging` | EU AI Act Art. 12 |
| `alerting.enabled`, `alerting.deliveries_30d` | `incident-identification-escalation` | APRA CPS 230 |
| `ci_gate.enabled`, `ci_gate.pass_rate_30d` | `model-change-governance` | EAAPL governance pattern |

Thresholds for `status`: `verified` if the relevant metric is present and above a floor (e.g.
`audit_coverage_pct >= 95`), `partial` if present but below floor, `stale` if `last_synced_at` is
older than 2× the poll interval, `missing` if the integration was never connected.

---

## 4. Security / privacy boundary (the part not to compromise)

- **Read-only, single-route key.** A `compliance_read` key cannot ingest, cannot read run
  content, cannot hit any other API route. If EAAPL's key storage is ever compromised, the
  blast radius is "aggregate compliance numbers for one org," not "someone's agent traces."
- **EAAPL pulls; Runback never pushes.** No webhook credential to manage on the Runback side,
  no outbound call Runback has to make to a third party — smaller attack surface, and it means
  a customer can revoke access by deleting the key with no coordination required from Runback.
- **No new data at rest on the Runback side.** Everything above is computed from existing
  tables at request time — this integration adds a route and a key scope, not a new store of
  sensitive data.
- **Product-only framing everywhere this is documented or linked.** No personal identity,
  either direction — this is a straightforward "Runback integrates with EAAPL" relationship,
  consistent with how every other integration on `/integrations` is described.

---

## 5. Build order

1. `scope` column + `compliance_read` key issuance UI + the evidence-summary route (Runback).
   Smallest, fully self-contained change; ships independent of EAAPL doing anything.
2. `integrations` + `evidence_records` tables + cron puller (EAAPL).
3. Wire `evidence_records` into the existing `apra-export`/tracker UI as a "verified" badge
   next to self-reported rows.
4. `/app/settings/compliance-key` UI polish (label, revoke, last-used) once the endpoint is
   proven against a real EAAPL pull.

## 6. Open questions to resolve before step 1

- Where does `sample` size get fixed — is 10 enough for an auditor to feel it's a real spot
  check without over-exposing usage volume?
- Is `compliance_read` an Enterprise-only feature (matches SSO/RBAC gating precedent) or
  available on Pro too? Affects `entitlements.ts`.
- Poll interval — hourly, daily? Affects the `stale` threshold and the rate-limit ceiling.
