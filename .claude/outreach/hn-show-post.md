# Show HN: Runback — tamper-evident audit log and deterministic replay for AI agents

**Title:** Show HN: Runback – re-execute any AI agent decision from its exact captured context

---

**Post body:**

I built Runback after watching a bank's AI team spend 3 hours in a war room trying to reproduce a loan-approval agent failure. They had logs. They had traces. They still couldn't reproduce it — because the model had non-deterministically taken a different path given the same prompt, and the retrieved documents from their vector store had silently changed.

The insight: traditional observability was built for deterministic systems. Software runs the same way twice, so a trace is enough. AI agents don't. Every decision is a function of the context assembled at runtime — retrieved documents, tool outputs, the exact messages[] array the model saw. A log records the outcome. Only a re-executable run shows you the reasoning.

**What Runback does:**

1. **Capture** — wraps your model call at the boundary. Records every LLM call, tool use, token, and reasoning step. PII redacted in-process before anything leaves your app.

2. **Replay** — re-executes any run from the exact captured context, tools and retrieval held fixed. A different output on replay means the model's behaviour has changed — that's the signal. Root cause in log₂ tries.

3. **Policy gates** — enforce rules before the model call executes. Synchronous, no network in your agent's critical path. The block is sealed into the record.

4. **Audit cassette** — SHA-256 hash-chained, HMAC-signed. Tamper-evident. Verifiable without a Runback account. Satisfies EU AI Act Art. 12 mandatory logging.

**3 lines to instrument:**

```ts
const dbg = withDebugger(openai("gpt-4o"), { runName: "loan-agent", redact: "standard" });
const result = await generateText({ model: dbg.model, tools: dbg.tools(myTools), prompt: task });
await dbg.finish({ output: result.text, status: "success" });
```

Framework-agnostic — works with LangChain, AutoGen, Mastra, CrewAI, or any model API.

**Self-hosted:** Free. Your data stays in your own Postgres. One docker-compose command.

**Live demo:** https://runback.dev/runs — open a real failing run and walk through the replay without a signup.

**Try to break the determinism claim:** https://github.com/letsRunback/runback-proofs — the oracle runs in public CI.

Happy to answer questions on the architecture, the capture approach, or the policy enforcement design.

---

**Best time to post:** Tuesday or Wednesday, 8–10am Eastern
**Target:** HN front page — aim for #1–15 in "Show HN"
**Goal:** developer signups + newsletter subscribers
