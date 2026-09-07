# Licensing

Runback is **proprietary software with a free Community edition**. It is not open
source. Two licenses apply; this file maps which functionality belongs to which.

- **Community edition** → [Runback Community License](LICENSE-COMMUNITY) — free to
  install, run, and self-host. Source-available, not open source: you may read,
  modify and redistribute it, but not offer it to third parties as a hosted or
  managed service.
- **Commercially-licensed features** → [Runback Commercial License](LICENSE-ENTERPRISE) —
  source is present for licensed customers, but production use requires a signed
  `RUNBACK_LICENSE` token. Without a Valid License these features cannot activate.

See the [`## Editions`](README.md#editions) table in the README for the user-facing
summary.

## Community (Runback Community License)

**Reclassified 2026-09-05:** `packages/replay/src/bisect.ts` and
`determinism.ts` moved from the commercial table to Community. Both are
small, pure, self-contained algorithms with no dependency on the replay
engine (bisect is textbook binary search over a caller-supplied predicate;
determinism is a report computed from already-captured events). Both were
already public — published in the `runback-proofs` repository and described
in a public blog post — and the marketing site's `/how-it-works` page runs
bisect live, in the browser, as its own proof of the mechanism. Gating them
would have broken that page in a Community build while protecting nothing
that wasn't already published. The defensible boundary is the re-execution
engine they drive, which remains commercial.


The core developer toolchain — free to run. Capture, single-step replay and
inspection, evals + the release gate, the per-run signed digest, the
org-wide tamper-evident audit ledger, redaction.

The ledger moved here from the commercial table on 2026-09-07. It was a
deliberate commercial decision, not a correction: the hosted free tier now
mirrors the Community edition, and the ledger is the capability that makes
LICENSE's "signed re-executable audit record" mean something an auditor can
check. Recording the reasoning because the split between "the per-run signed
digest" and "the org-wide ledger" is exactly where this document and LICENSE
read differently, and the next person will need to know which way it was
settled.

This list and the table below predate several shipped features (policy
tooling, cost/benchmark/regulatory reporting, incidents, approvals, prompt
management, and more) that aren't mentioned in either. `web/lib/entitlements.ts`'s
`PLAN_FEATURES` is the actual source of truth for what's free vs. licensed —
don't assume an unlisted feature is Community just because it's absent here.

- `packages/` — **MIT, not the Community Licence**: `sdk`, `verify`,
  `verify-action`, `sdk-python`. Each declares `"license": "MIT"` in its
  manifest and `@runback/verify` and `@runback/sdk` are published to npm under
  it, so the grant is already made and cannot be narrowed for copies already
  distributed. /security and /verify state publicly that the verifier is MIT.
  As of 2026-09-07 each ships a LICENSE file — MIT requires the notice to
  travel with copies, and publishing MIT packages without it did not satisfy
  the licence they declare. Permissive client libraries are also the norm
  (Stripe, Datadog, Segment); the commercial boundary is the server, not the
  capture client.

  This entry previously listed the `sdk` under the Community Licence, which
  contradicted its own manifest and the public claim.

- `packages/` under the **Community Licence** — `schema`, `redact`, `gateway`,
  and the base `replay` (`cassette` basics, `digest`, `audit`).
- `web/lib/` — `runs`, `audit`, `ingest`, `replay/runStep`, `replay/simulate`,
  `eval/*`, redaction.
- `web/app/` — ingest/read APIs, the run debugger (`/runs`, `/app/runs`), evals &
  datasets (`/app/evals`, `/app/datasets`), the marketing site, sign-in.
- `web/components/debugger/*`, `web/components/eval/*`.
- `sql/` — `create_api_keys`, `create_runs`, `create_events`, `create_eval`, `create_eval_tenancy`.

## Commercially-licensed features (Runback Commercial License)

Gated by the entitlement system (`web/lib/entitlements.ts`) + license
(`web/lib/license.ts` / `RUNBACK_LICENSE`), and enforced fail-closed at both the API
route AND inside each engine orchestrator. Production use requires a Valid License —
but not every row below needs an Enterprise-*tier* license specifically. The plan
embedded in the license token decides which features it unlocks, the same way it
does on the hosted service (see `minPlanFor()` in `entitlements.ts`); a feature
listed here just means it's off entirely without any license at all.

| Feature | Key files |
|---|---|
| **Deep replay — H1 environment capture** | `packages/sdk/src/envCapture.ts`, `captureEnv` path in `packages/sdk/src/collector.ts` |
| **Deep replay — H2 salience projection** | `projectInput` / `toolKeyP` / `llmKeyP` and `key_projection` handling in `packages/replay/src/cassette.ts` |
| **Deep replay — H3 hybrid / whole-run / counterfactual** | `packages/replay/src/enterprise/{hybrid,fromEvents,runReplay,native}.ts`, `packages/sdk/src/replay.ts`, `web/lib/enterprise/replay/wholeRun.ts`, `web/app/api/runs/[run_id]/{reexecute,bisect,cassette,audit}`, `web/app/api/app/fleet-determinism` |
| **Native deterministic capture** | `packages/replay/src/native.ts`, `native/`, `linux/` |
| **Golden corpus (regression mining)** — Growth-tier license, not Enterprise-exclusive | `web/lib/golden.ts`, `web/lib/goldenCore.ts`, `web/app/api/golden/*`, `web/app/app/golden/*`, `sql/create_golden.sql` |
| Entitlement & license gate | `web/lib/entitlements.ts`, `web/lib/license.ts`, `web/lib/planGate.ts` |
| Multi-tenant workspaces + RBAC | `web/lib/auth.ts` (orgs/memberships/sessions), `web/app/app/team/*`, `web/app/api/team/*`, `sql/create_tenancy.sql` |
| Fleet control-room dashboard | `web/lib/dashboard.ts`, `web/components/app/charts.tsx`, `web/app/app/page.tsx` (dashboard branch) |
| SSO (OIDC) | `web/lib/sso.ts`, `web/app/app/settings/sso/*`, `web/app/api/auth/sso/*`, `web/app/api/settings/sso/*`, `sql/create_sso.sql` |
| Alerting | `web/lib/alerts.ts`, `web/app/app/alerts/*`, `sql/create_alerts.sql` |
| Usage metering & billing | `web/lib/usage.ts`, `web/lib/billing.ts`, `web/app/app/usage/*`, `web/app/app/upgrade/*`, `web/app/api/billing/*`, `web/app/api/cron/retention/*`, `sql/create_usage.sql`, `sql/create_billing.sql` |
| Long retention | enforced in `web/lib/usage.ts` / `web/lib/entitlements.ts` |

This table is not exhaustive — see the caveat under Community above. Check
`minPlanFor()` in `web/lib/entitlements.ts` before assuming an unlisted
feature is free.

## Getting a license

Enterprise licenses are issued by Runback and verified with Ed25519 against an
embedded public key — an arbitrary `RUNBACK_LICENSE=enterprise` does nothing; only
Runback (holder of the private key) can mint a Valid License. Request one at
<https://runback.dev/contact>.
