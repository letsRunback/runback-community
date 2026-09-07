# Deterministic Substrate — Depth Spec

> The engineering plan for the two defensible features:
> **(1) environment-deterministic replay → regression mining → bisection**, and
> **(2) policy simulation → runtime enforcement.**
> Both are applications of ONE substrate. This spec goes to the sea floor of that
> substrate, grounded in the code that exists today.

---

## 0. Where we actually are (honest map)

Three capture tiers already feed one cassette format:

| Tier | Source | Captures | Code |
|---|---|---|---|
| In-process JS | `harness.record()` shims | `now/random/uuid/date/fetch/tool` | `packages/replay/src/harness.ts` |
| Gateway | base-URL proxy | `http` (method+path+body) | `packages/gateway`, `cassette.proxyKey` |
| Native | libc interposition (C/Go/Rust/robotics) | `clock/random` | `native/runback_native.c`, `packages/replay/src/native.ts` |

The cassette is content-addressed + hash-chained (`cassette.ts`): each `Entry{seq,kind,key,output,hash}`, `digest` = final chain hash. Replay (`harness.replay`) feeds recorded values back, recomputes the chain, and reports `VerifyOutcome{ ok, consumed, total, divergedAt }`. The digest fuses into the signed audit record and the org ledger.

**This is genuinely deep. The gaps are two seams, not a missing foundation.**

### Seam A — production capture is shallow
`withDebugger()` / `startRun()` (`packages/sdk/src/index.ts`) record **only** `llm` events (via `debuggerMiddleware`) and `tool` events (via `instrumentTools`). They do **not** install the harness env shims. So a production run's cassette (`cassetteDigestFromEvents`, `digest.ts`) chains **llm + tool only** — it is blind to `now/random/uuid/fetch/retrieval`. Any agent that branches on time, randomness, or RAG is **not** byte-exact reproducible from production capture today.

### Seam B — the production replay engine stops at first divergence
The web UI uses `reexecuteRun()` / `counterfactualRun()` (`runReplay.ts`), which work from stored events with **no code**. `counterfactualRun` follows the recorded oracle while a new model's decision matches, and **breaks at the first divergence** ("honest about where it stops — we can't run your tools"). `harness.replay` *can* run forward but `consume()` is a **positional tape** that throws `ReplayDivergence` at the first mismatch. Neither continues *past* divergence. That capability — continue past divergence by going live only where needed — is the OMG, and nothing does it yet.

---

## 1. The depth program (ordered; each item is a named hard problem)

### 1.1 Unify capture — every production run becomes a full cassette
Move the harness env-interception into the `Collector` so `withDebugger`/`startRun` capture `now/random/uuid/date/fetch/retrieval` **inline in production**, emitting them as first-class entries alongside `llm`/`tool`. The LLM call becomes just another oracle entry (`kind:"llm"`, key=`llmKey`). Extend `cassetteDigestFromEvents` to chain the env entries too (old runs without them still chain — backward compatible).

**Hard problem H1 — concurrency-safe, async-scoped interception.** `Date.now`/`Math.random`/`fetch` are process globals. In a shared, multi-tenant server (or any agent with parallel sub-tasks) you cannot globally shim them without cross-run contamination. Required: interception scoped by `AsyncLocalStorage` to the current run, with the `harness.ts` `inTool` depth-guard generalized to a per-context stack so tool-internal nondeterminism stays opaque. **This is the thing naive clones get wrong** — they shim globals and corrupt under concurrency. Getting it correct (and zero-overhead when no run is active) is months of careful work.

Deliverable: `ad_events` gains env event types; `Collector` opens/closes an interception scope per run; `cassetteDigestFromEvents` includes them. A "determinism score" per run = fraction of nondeterminism sources captured (flag uncaptured ones).

### 1.2 Positional tape → content-addressed oracle map
Replace `consume()`'s positional matching (`harness.ts` L210–224) with a **key-indexed FIFO multiset**: `Map<key, Queue<Entry>>`. A consumption of `(kind,key)` pops that key's queue → **hit** (serve recorded, deterministic, free); empty → **miss** (a genuine new input). Keep the global hash-chain for the *verification* digest, but **decouple alignment from position**. This single change makes replay robust to reordering, **concurrency** (parallel tool calls have nondeterministic order — positional replay can't survive it; key-indexed can), and insertion/deletion — the precondition for continuing past divergence.

**Hard problem H2 — stable content-addressing under input volatility.** `toolKey = sha256(name + canonical(input))` (`cassette.ts` L69). Real inputs carry volatile fields — `request_id`, timestamps, nonces, full chat history — so the same logical call hashes differently every run → false miss → the whole engine becomes noise. Required: a **salience projection** per tool/model — declared (or learned) "key fields" that normalize inputs before keying (drop volatile fields, canonicalize history to a window, round floats). This is subtle, per-integration, and is where the real tuning-months live. It is also the difference between a demo that reproduces and one that "diverges" on every run.

### 1.3 Hybrid replay engine — "cache-or-live", continue past divergence
New mode beyond record/replay: `reexecute(cassette, drive, { onMiss })`. Re-drive the agent loop; each consumption: **hit** → recorded value; **miss** → `onMiss` policy = `live` (real tool/model call), `block` (controlled value), or `freeze` (mark unknown). Track a **divergence frontier** and per-entry **provenance** (`recorded | live | blocked`). The verification digest holds *up to the frontier* — a cryptographic proof that everything upstream is bit-identical — then provenance shows the live tail.

**Hard problem H3 — divergence-frontier execution with an upstream proof.** This is the agent analog of `rr`'s "diversion": fork from a deterministic prefix into a live tail while preserving proof of the prefix. For **events-only** runs (no code) you can't run the agent forward, so this needs a re-drivable **control-flow skeleton** captured at record time (the step graph: which `llm` step spawned which `tool` calls, with the branch structure) so `reexecuteRun` evolves from "verify the chain" into "re-drive the loop generically, swap one oracle, go live on misses past the frontier." H3 is what turns a *verifier* into a *counterfactual engine*.

### 1.4 Intervention-forward = hybrid replay + an injected gate  → Feature 2
Policy **simulation over history**: for each historical cassette, run `reexecute` with a `policyGate(step)` that evaluates the candidate policy before each action; if it would **block**, treat the action as a miss and continue forward (`live` or `freeze`) to compute the counterfactual outcome. Aggregate across all cassettes → *"this policy would have blocked 47 actions, prevented 3 incidents, with these exact runs."* Runtime **enforcement**: the SAME `policyGate` as a **pre-hook** in the live `Collector` (mirror of the existing post-hook capture). One engine, three uses: **simulate, enforce, replay-the-enforcement** (every block is itself a recorded, sealed, re-runnable entry).

### 1.5 Bisection + regression mining  → Feature 1 demos
- **Bisection**: drive `reexecute` across an ordered change set (model vN, prompt vM, tool vK), binary-searching for the outcome flip. Cheap — every trial is cache-hits except the isolated axis. Output: "regression introduced by prompt v14."
- **Mining**: auto-enroll any cassette whose outcome is "bad" (policy breach, error, low eval) into a **golden suite**; CI re-runs them via `reexecute`. The suite is mined from production, grows with usage, and a new entrant starts at **zero** on it.

---

## 2. The three problems that ARE the moat (the "can't build in months" bar)

- **H1** async-scoped, concurrency-safe environment interception.
- **H2** stable content-addressing under input volatility (salience projection).
- **H3** divergence-frontier hybrid execution with a cryptographic upstream proof.

Each is months-to-years individually; they **compound** (H3 needs H2 needs H1); and the **production cassette corpus** is a data asset a competitor cannot backfill. A funded team clones the UI in a fortnight and still cannot produce a *correct* counterfactual without solving all three — and cannot simulate a policy against a history they don't have.

---

## 3. Data-model evolution (concrete, backward-compatible)

1. `EntryKind` already includes `now|random|uuid|date|fetch|http|clock`; add `llm|tool|retrieval` so ONE chain spans env + oracle.
2. `ad_events`: add env event rows (new `type`s) written by the scoped interceptor; extend `cassetteDigestFromEvents` to chain them (absent on old runs ⇒ unchanged digest).
3. New `tool_key_projection` config (salient input fields) per tool, stored alongside the dataset/tool registry; default = "all fields" (lossless but volatile) with a UI to mark volatile fields.
4. Capture a **control-flow skeleton** per run (parent/child step graph — `parent_span_id` already exists on tool events) sufficient to re-drive the loop in §1.3.
5. Extend result types: `VerifyOutcome`/`RunReexecution` gain `frontier:{seq}` and per-step `provenance`.

---

## 4. The two OMG demos this unlocks

**Demo 1 — replay/bisection.** Open a 3-week-old incident → replay reproduces byte-exact (hash matches) → flip the model, every tool/retrieval/clock held identical, diverges at exactly step 4 with the diff → "what changed since it passed" → bisection names prompt v14. All offline, deterministic, repeatable.

**Demo 2 — policy sim → enforce → prove.** Write a policy → simulate against 90 days (names, amounts, "would have prevented the June 2 incident") → flip to Enforce → live run blocks the bad action and the agent re-plans → replay the block to prove it. One policy, one screen.

---

## 5. Build sequence (no throwaway work)

1. **§1.1 + §1.2** — scoped env capture + content-addressed oracle map. Foundation; both features depend on it. Ship a "determinism score" as the first visible surface.
2. **§1.3** — hybrid replay (continue past divergence). Unlocks Demo 1's "forks live after step 4."
3. **§1.5** — bisection + golden suite → **Demo 1 complete**.
4. **§1.4** — policy pre-hook (enforcement) + sim-over-history → **Demo 2 complete**.

Step 1 is the shared dependency and the home of H1/H2; everything else is an application of it.
