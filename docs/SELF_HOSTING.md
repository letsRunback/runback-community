# Self-hosting Runback

Run Runback entirely inside your own network so traces never leave your control.
The app is a Next.js server plus a Postgres database — nothing else is required.

## Data layer

Runback talks to its database through the Supabase client (PostgREST + a service
key). You have three options, all keeping data in your control:

1. **Your own Supabase project** — create one in your account/region, run the SQL
   in `sql/`, and use its URL + keys. Simplest.
2. **Self-hosted Supabase** — run the Supabase Docker stack on your infra and
   point Runback at it. Fully air-gapped.
3. **Your own Postgres + PostgREST** — any Postgres with a PostgREST gateway and a
   service JWT works, since the client only uses PostgREST.

> Roadmap: a direct-`pg` driver so option 3 needs no PostgREST. Until then, use
> option 1 or 2.

## Quick start (Docker)

1. Provision the database (one of the options above) and apply **every** file in
   `sql/`, in filename order:

   ```bash
   for f in sql/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```

   This used to say "the three files in `sql/`". There are 99, and the missing
   ones are not optional extras — they include the admin audit log, legal holds,
   SIEM sinks, uptime checks, and `scope_run_id_per_org.sql`, which makes tenant
   isolation a composite `(org_id, run_id)` key the database enforces rather
   than something the application remembers to filter on.

   Using the bundled Postgres (`docker compose up`) applies all of them for you
   on first boot; this step is only for an external database.

2. Create a `.env` next to `docker-compose.yml`:
   ```
   NEXT_PUBLIC_SUPABASE_URL=https://your-db-host
   SUPABASE_SERVICE_ROLE_KEY=...

   # Required. Compose reads these; several features fail closed without them.
   JWT_SECRET=...                 # openssl rand -hex 32 — signs sessions
   AUDIT_SIGNING_KEY=...          # openssl rand -hex 32 — seals the audit ledger AND
                                   # inter-agent trust-chain attestations (same key, same
                                   # signing module — see .env.example for the Ed25519 upgrade)
   MODEL_KEY_SECRET=...           # openssl rand -hex 32 — encrypts stored provider keys
   CRON_SECRET=...                # openssl rand -hex 32 — authenticates scheduled jobs
   POSTGRES_PASSWORD=...          # bundled Postgres superuser password — docker-compose.yml
                                   # hard-fails ("POSTGRES_PASSWORD must be set in .env")
                                   # without this; do not leave it blank
   AUTHENTICATOR_PASSWORD=...     # bundled Postgres role password
   NEXT_PUBLIC_APP_URL=http://localhost:3000

   # Sign-in. Without an email provider the magic link cannot be delivered —
   # the server prints it to the log instead, which is enough to get in.
   RESEND_API_KEY=...             # optional

   # No need to set this — a private-address identity provider, alert target,
   # or SIEM collector (normal inside a VPC) is reachable by default here.
   # Set RUNBACK_ALLOW_PRIVATE_TARGETS=false only if you want the stricter,
   # hosted-style SSRF guard anyway. Ignored on the hosted service either way.

   # Optional, only for step replay:
   GROQ_API_KEY=...
   OPENAI_API_KEY=...
   ANTHROPIC_API_KEY=...
   ```

   `NEXT_PUBLIC_SUPABASE_ANON_KEY` **is required** for database-enforced tenant isolation. This previously said no code read it — true when written, not now: `web/lib/supabase/tenant.ts` uses it as the `apikey` header while the per-tenant token goes in `Authorization`. Without it, reads fall back to the service-role client and row-level security is bypassed, silently. See `docs/RLS-PLAN.md`.
   code in the project — you do not need it.

3. Build and run:
   ```bash
   docker compose up --build
   ```
   Runback is on `http://localhost:3000`.

4. Sign in. Go to `/login`, enter your email, and submit.

   With `RESEND_API_KEY` set you receive the link by email. **Without it, the
   link is printed to the container log** — the send fails, and the API still
   answers `{"ok":true}` so it cannot be used to probe which addresses exist:

   ```bash
   docker compose logs web | grep "Sign-in link"
   ```

   Paste that URL into your browser and the workspace is created. Previously
   there was no way through this step at all without an email provider: the
   link existed only in memory and the failure was a single console.error.

5. Mint an ingest API key:
   ```bash
   node scripts/make-api-key.mjs you@company.com
   ```
   Run the printed `INSERT`, then point your agents' SDK / OTLP exporter at your
   host with that key.

## Scheduled jobs

The hosted deployment runs 18 background jobs on a schedule (`web/vercel.json`'s
`crons` array) — ledger checkpoint sealing, the `guard` kill-switch, retention
enforcement, SIEM export, drift/error alerting, and more. `docker compose up`
brings up a `scheduler` service that runs the same 18 jobs on the same
schedule, authenticated with the same `CRON_SECRET` — nothing extra to
configure. Watch it with:

```bash
docker compose logs -f scheduler
```

Running without Docker, or pointing at an external scheduler instead? Every
job is a single authenticated `GET`, so any cron implementation works —
`selfhost/cron/crontab.template` is the schedule to replicate:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/retention
```

## Without Docker

```bash
npm install
npm run build
npm run start   # serves the web workspace on :3000
```

## Privacy posture

- **Redaction runs in your agent's process** (`redact: "standard"`), before any
  trace is sent — even to your own Runback instance. Configure detectors in the
  SDK options.
- **The replay endpoint only re-issues requests already captured in a run** — it
  never accepts a free-form prompt, so it can't be used to exfiltrate via your
  provider keys.
- **No product telemetry leaves your network.** There is no call-home to
  Runback's own infrastructure.
- **Exception, by default: checkpoint witnessing.** Sealing a ledger
  checkpoint (`POST /api/app/ledger`) requests an RFC 3161 timestamp from two
  public authorities (freetsa.org and timestamp.digicert.com) unless
  `RUNBACK_TSA_URLS` is set — that's what makes a sealed checkpoint verifiable
  by a third party without trusting Runback. Only the checkpoint's hash and
  your request's source IP reach those authorities; no run content, PII, or
  org-identifying data does. For a genuinely air-gapped deployment, set
  `RUNBACK_TSA_URLS` to an internal RFC 3161 authority (see
  [WITNESSING.md](./WITNESSING.md)) — checkpoints still seal and verify
  locally with no external witness if you never configure one; you only lose
  third-party-verifiable timestamping, not the ledger itself.

## Connect your LLMs

**You usually don't need to.** Your agents already call your own LLM providers;
Runback's SDK just *records* those calls — your provider keys live in your agent,
not in Runback. Observing agents, time-travel replay, and the signed audit export
all work with **no LLM key at all**.

You only connect a provider key when you want Runback to **re-execute** a step
itself — i.e. live "replay from step N" or eval **LLM-judges**. With the
one-command Docker setup:

```bash
cp .env.example .env          # then edit .env and add the key(s) you use:
#   OPENAI_API_KEY=sk-...
#   ANTHROPIC_API_KEY=sk-ant-...
#   GROQ_API_KEY=gsk_...
docker compose up             # the app picks the keys up from .env
```

Supported providers today: **OpenAI** (`gpt-4o`, `gpt-4o-mini`, `gpt-4.1`),
**Anthropic** (`claude-sonnet-4-6`, `claude-haiku-4-5`), and **Groq**
(`gpt-oss-120b/20b`, `qwen3-32b`, `llama-3.x`). Set only the providers you use;
models whose key isn't set are simply unavailable for replay (the UI says so).
Azure OpenAI / AWS Bedrock / self-hosted models aren't wired yet — ask if you
need one.

Keys are only ever used to re-issue a request **already captured in a run** — the
replay endpoint never accepts a free-form prompt, so it can't be used to
exfiltrate through your provider keys.

## Optional secrets

`SSO_SECRET_KEY`, `MODEL_KEY_SECRET`, `SIEM_SECRET_KEY`, and
`WORKFLOW_SECRET_KEY` are all genuinely optional — skip any feature you don't
use and its secret with it. But each one, unset, throws the first time someone
tries to *save* that feature's config (SSO, a BYOK model key, a SIEM sink, a
ServiceNow/Jira/PagerDuty sink), not before. To avoid finding that out three
weeks in, `docker compose logs web` prints a one-time summary at startup of
which of these are unset and what they gate — check it once after your first
`docker compose up`.

## Seats

Every plan (Community included) has a seat limit — see the
[pricing page](https://runback.dev/pricing) for exact numbers per tier, or
`web/lib/entitlements.ts`'s `PLAN_LIMITS` in this repo. Settings → Team shows
current usage and disables inviting past the limit; an Enterprise license
(`RUNBACK_LICENSE`) lifts the cap entirely.

## Editions & licensing

Runback self-host has two editions (proprietary; the Community edition is free to run):

- **Community edition — free, forever.** The core dev-tools: capture every agent run, deterministic time-travel replay, the signed re-executable audit record, evals + the release gate, single workspace. No license needed; download and run.
- **Enterprise features — require a signed license.** The fleet control-room dashboard, team roles (RBAC), SSO (OIDC), alerting, and long retention are **locked** until `RUNBACK_LICENSE` holds a license token that Runback signed for you.

The license is cryptographically signed — setting `RUNBACK_LICENSE=enterprise` (or any made-up value) does **not** unlock anything; it's verified against an embedded public key. To get a license, [contact us](https://runback.dev/contact).

```bash
# Community: just run it.
docker compose up

# Enterprise: drop in your signed license.
RUNBACK_LICENSE=eyJ...the-token-we-issue... docker compose up
```
