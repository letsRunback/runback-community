# research-email-agent

A small instrumented agent — research → fetch → summarize → email — wrapped
with `withDebugger()` from `@runback/sdk`. It's deliberately seeded to fail:
the task always asks it to email a summary to `jordan[at]example.com`, which
isn't a valid address, so the final `send_email` tool call fails with
`SMTP 550: invalid recipient address`.

This is a good demo of replay because the failure is a single bad tool-call
input, cleanly fixable (swap in a valid address), and deterministic — the fix
always succeeds, so it reliably shows the debugging loop end to end:

```
capture (broken run) → inspect (Context tab shows the malformed address)
                     → Replay tab, edit the address → re-run → succeeds
```

## Run it live

Requires a Groq API key (`GROQ_API_KEY` in this directory's `.env`, see
`.env.example` at the repo root):

```bash
npm run demo     # from the repo root — runs this workspace's `start` script
```

This calls the real model via Groq, runs the agent, and prints a link:
`🔍 Open in Runback: <base>/runs/<run_id>`.

## See the pre-seeded version (no API key needed)

The same scenario is also available as a static, hand-authored fixture — no
Groq key, no live model call:

```bash
npm run seed      # from the repo root
```

This seeds a stable, durable run at `/runs/demo-email-agent` — safe to
re-run (idempotent), and linkable directly for demos/marketing without
re-seeding.

To capture the "watch replay fix it" flow as a recording (screenshots +
video), see `scripts/demo-record.cjs` at the repo root:

```bash
npm run seed
BASE=http://localhost:3000 npm run demo:record
```

Note: the default zero-auth demo path is answered by a cost-free simulator
that doesn't re-derive tool calls from edited text — it's a UI smoke check,
not proof of a fix. `demo-record.cjs`'s header comment explains how to run
it with `RB_SESSION_COOKIE` against a real account for the authentic
recording used in marketing.

## Files

- `agent.ts` — wraps `generateText` with `withDebugger(groq(...))`.
- `run.ts` — CLI entry; builds the (malformed) task and prints the run URL.
- `tools.ts` — `web_search`, `fetch_url`, `send_email`; `send_email` validates
  the recipient and throws the SMTP error on a malformed address.
