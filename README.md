# Runback

[![determinism-proof](https://github.com/letsRunback/runback-proofs/actions/workflows/determinism-proof.yml/badge.svg)](https://github.com/letsRunback/runback-proofs/actions)
[![Community edition](https://img.shields.io/badge/Community%20edition-free-10b981)](LICENSE-COMMUNITY)
[![Live demo](https://img.shields.io/badge/live%20demo-runback.dev-4f9cf9)](https://runback.dev)

**The system of record for AI agents.** Capture every decision your
agents make, then step through any run and see *exactly what the model saw at
every step* — the full context window, the tool calls and their results, and
where it broke — instead of a wall of logs. Re-run it, gate it, and keep a
signed record.

Existing tools (LangSmith, Langfuse, Braintrust) are read-only observability.
Runback's inspector is the depth they don't have:

- **Context tab** — reconstructs the exact `messages` array + system prompt +
  in-scope tool definitions the model received at step N.
- **Causal links** — clicking a tool span jumps to the LLM step that requested
  it (and vice-versa), via `tool_call_id`.
- **Error-first navigation** — the run opens focused on the step that failed.
- **Replay-from-step-N** — re-issue any LLM step's exact captured request, or edit
  the prompt/messages and see how the model responds differently. The captured
  context window becomes a live, editable experiment. (No other tool does this.)

Live demo: **https://runback.dev**

## Editions

Runback is **proprietary, with a free Community edition**. Self-host the full
developer toolchain for free — the team and governance features are commercial.
The Community edition is free to run and source-available — not open source.

| | **Community** (this repo) | **Enterprise** (licensed) |
|---|---|---|
| Capture every agent run | ✓ | ✓ |
| Deterministic **time-travel replay** | ✓ | ✓ |
| Signed, **re-executable audit record** | ✓ | ✓ |
| **Evals + the release gate** | ✓ | ✓ |
| Workspaces | single | multi-tenant |
| Fleet **control-room dashboard** | — | ✓ |
| **Team roles (RBAC)** | — | ✓ |
| **SSO** (OIDC) | — | ✓ |
| **Alerting** (email · Slack · webhook) | — | ✓ |
| Long retention | — | ✓ |

**Community is free, forever** — no license needed, nothing crippled. Enterprise
features are unlocked by a cryptographically **signed license** in `RUNBACK_LICENSE`;
a made-up value like `enterprise` does nothing (it's verified against an embedded
public key). [Request a license →](https://runback.dev/contact)

```bash
docker compose up                              # Community
RUNBACK_LICENSE=eyJ...your-token... docker compose up   # Enterprise
```

See [`docs/SELF_HOSTING.md`](docs/SELF_HOSTING.md) for details.

## How it works

```
your agent ──(wrapLanguageModel middleware + tool wrapping)──▶ flat trace events
        │
        └─▶ POST /api/ingest ─▶ Supabase (ad_runs, ad_events) ─▶ Timeline + Inspector UI
```

The SDK captures the request side at the `wrapLanguageModel` boundary — the only
layer where the fully-assembled context window is visible.

## Layout

| Path | What |
|------|------|
| `packages/schema` | The trace-event wire format (v1) + zod validation. The contract. |
| `packages/sdk` | `withDebugger()` — instrument a Vercel AI SDK agent in ~3 lines. |
| `web` | Next.js 16 app: ingest/read API + Timeline + Step Inspector. |
| `examples/research-email-agent` | A real instrumented agent that fails on send, to debug. |
| `sql` | Supabase tables (`api_keys`, `ad_runs`, `ad_events`). |

## Setup

1. **Install**
   ```bash
   npm install
   ```

2. **Supabase** — create a project, then run **every** file in `sql/` in
   order:

   ```bash
   for f in sql/*.sql; do psql "$DATABASE_URL" -f "$f"; done
   ```

   This used to say "the three files in `sql/`". There are 99, and the rest are
   not optional extras — they include the admin audit log, the ledger, legal
   holds, and `scope_run_id_per_org.sql`, which makes tenant isolation a
   composite `(org_id, run_id)` key the database enforces. `docs/SELF_HOSTING.md`
   was corrected for this; the README was not.

3. **Env** — copy `.env.example` to `.env.local` (web) / `.env` (root + example)
   and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`
   - `GROQ_API_KEY` (only to run the live demo agent)

4. **Mint an API key** (auth for the ingest endpoint):
   ```bash
   node scripts/make-api-key.mjs you@email.com
   ```
   Run the printed `INSERT` in Supabase, and put the raw key in
   `RUNBACK_API_KEY`.

5. **Run the app**
   ```bash
   npm run dev        # http://localhost:3000
   ```

## See it work

**Option A — seed a fixture (no Groq key needed):**
```bash
npm run seed         # hand-authored failing run
```

**Option B — run the live agent:**
```bash
npm run demo         # research → fetch → email; fails at send_email
```

Both print a `…/runs/<id>` URL. Open it: the Timeline shows the steps with
`send_email` lit red, and the **Context tab** reveals the malformed address the
model passed — the failure, found in one click.

### Replay

Open any LLM step → **Replay** tab. Hit "Replay as-is" to re-issue the exact
captured request, or edit the system prompt / messages and "Run edited replay"
to compare the original and new responses side-by-side. The endpoint only replays
requests already captured in a run (it never accepts a free-form prompt), so the
public deployment can't be used to burn the API key.

### Keyboard

`j` / `k` (or ↑ / ↓) move between steps.

### Demo model

The demo defaults to `openai/gpt-oss-120b` on Groq (reliable tool-calling).
`llama-3.3-70b-versatile` intermittently malforms tool calls with the AI SDK —
override via `GROQ_MODEL` in `examples/research-email-agent/.env` if you like.

## Instrument your own agent

### With the Vercel AI SDK

```ts
import { withDebugger } from "@runback/sdk";
import { generateText, stepCountIs } from "ai";

const dbg = withDebugger(model, {
  runName: "my-agent",
  input: task,
  redact: "standard", // redact secrets/PII before anything leaves the process
});
const res = await generateText({
  model: dbg.model,
  tools: dbg.tools(myTools),
  stopWhen: stepCountIs(8),
  prompt: task,
});
await dbg.finish({ output: res.text, status: "success" });
```

### With any framework, via OpenTelemetry

No Runback SDK required. Point any OpenTelemetry GenAI exporter (OpenLLMetry /
Traceloop, OpenInference, native OTel — i.e. LangGraph, CrewAI, LlamaIndex, …) at
the OTLP endpoint:

```bash
OTEL_EXPORTER_OTLP_TRACES_ENDPOINT=https://<your-host>/api/otel/v1/traces
OTEL_EXPORTER_OTLP_TRACES_PROTOCOL=http/json
OTEL_EXPORTER_OTLP_TRACES_HEADERS=authorization=Bearer <RUNBACK_API_KEY>
```

Runback maps `gen_ai.*` spans (and OpenInference `llm.*` / `tool.*`) into the
same runs you see in the UI — LLM spans, tool spans, token usage, and errors.

## Redaction (privacy / security)

`@runback/redact` scrubs secrets and PII from every event **inside your process,
before it is sent anywhere**. Enable it on the SDK with `redact: "standard"`
(high-confidence detectors) or `"strict"` (adds phone/IP), or pass full options:

```ts
withDebugger(model, {
  runName: "my-agent",
  redact: {
    preset: "standard",
    redactKeys: ["x_internal_id"],        // also blank these object keys
    customPatterns: [{ name: "emp", regex: /EMP-\d{5}/g }],
    allowKeys: ["model_id"],              // never touch these
  },
});
```

Built-in detectors: emails, OpenAI/Anthropic/Groq/Stripe/GitHub/Slack/Google/AWS
keys, JWTs, bearer tokens, private-key blocks, SSNs, Luhn-valid cards (+ phone/IP
in strict). Token counts, latencies, model ids, and span structure are preserved
so monitoring and eval still work on redacted traces.

## Tests

```bash
npm test     # vitest — redaction detectors + OTel mapper
```

## Found a bug?

The Community edition is proprietary (see [LICENSE-COMMUNITY](LICENSE-COMMUNITY)) — this
repo isn't open to external code contributions, but bug reports and feature requests
against the self-hosted Community edition are welcome — while this repo is private
during the beta, send them to <support@runback.dev> or via
[runback.dev/support](https://runback.dev/support). Include your
`docker compose` / self-host setup, the command you ran, and (if it crashed) the
relevant `ci_results.jsonl` or server log line — that's usually enough to reproduce.

## Deferred (the schema already unblocks each)

Breakpoints · state editing · branch diffing. Every span has a stable `span_id`,
the request is captured verbatim, and `parent_span_id` models the tree — so these
are additive. **Shipped since v0.1:** replay-from-step-N, OpenTelemetry ingestion,
in-process redaction.
