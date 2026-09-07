# Runback → Agent-Reliability Platform

*Plan to convert the CRO's six "no"s into "here's the PO." Written June 2026.*

---

## The thesis: one instrumentation, four products

The CRO's verdict was correct — a *debugger* alone is a feature inside someone
else's platform purchase. The fix is not four new products. It's recognising that
**the trace-event schema is a spine that four products hang off, and we already
built the two hardest pieces.**

```
            ┌──────────────── the SAME captured trace ────────────────┐
            │                                                          │
   ┌────────▼────────┐  ┌──────────┐  ┌───────────┐  ┌────────────────▼─┐
   │  DEBUG (built)  │→ │   EVAL   │→ │  MONITOR  │→ │       GATE        │
   │ step-through    │  │ runs →   │  │ always-on │  │ CI regression     │
   │ replay+inspect  │  │ datasets │  │ dashboards│  │ block bad deploys │
   │  = the hook     │  │ +scorers │  │ +alerting │  │  = highest WTP    │
   └─────────────────┘  └──────────┘  └───────────┘  └──────────────────┘
        free/OSS          free-ish        PAID             PAID
       (land + own        (creates       (daily,         (blocks deploys,
        instrumentation)   the asset)     recurring)       clear ROI)
```

**Why this is cheap to build (the reuse insight):**

| Platform piece | What it actually is | Already built? |
|---|---|---|
| The data model | flat trace-event stream, stable `span_id`, verbatim request capture, OTel-shaped | ✅ `packages/schema` |
| Faithful re-execution | replay a captured request via `doGenerate` | ✅ `/api/replay` |
| **Eval** | **replay × a dataset + scorers** | replay done; need datasets + scorers |
| **Monitor** | **aggregate the event stream we already ingest** | ingest done; need rollups + alerts |
| **Gate** | **run the eval suite in CI + diff vs baseline** | rides entirely on Eval |

The replay engine *is* the eval engine. The trace schema *is* the monitoring
spine. This is assembly + scorers + dashboards + a CI action — **not a rebuild.**

---

## The monetization ladder (what's free, what's paid, why)

| Tier | Contains | Logic |
|---|---|---|
| **Free / OSS** | SDK + self-host debug + replay | Land bottoms-up. Own the *instrumentation pipe* (moat #6). Viral, no procurement. |
| **Team (paid)** | hosted Monitor + Eval + collaboration + retention | The always-on daily value (#2). Recurring budget. |
| **Enterprise (paid)** | Gate + SSO + RBAC + SOC2 + self-host support + SLA | Highest willingness-to-pay (#3) + clears procurement (#4). |

Lead the **narrative** with debug (the hook). Lead the **revenue** with gate +
monitor. The free debugger populates datasets → datasets make eval/gate possible
→ gate/monitor are what get a PO. That's the flywheel.

---

## Phased roadmap

Each phase: goal · what to build (reusing the codebase) · CRO req it clears · exit
criteria. Effort = realistic solo-dev weeks.

### Phase 0 — Foundation & trust (clears #1, #4-partial, seeds #6) · ~3–4 wks
The unlocks that gate everything else and clear procurement.

> **Status (June 2026): COMPLETE.** ✅ OTel ingest adapter (`/api/otel/v1/traces`,
> `gen_ai.*` + OpenInference) · ✅ `@runback/redact` + SDK `redact` option (in-process,
> 32 passing tests, verified end-to-end) · ✅ multi-provider replay (Groq/OpenAI/
> Anthropic, graceful key gating) · ✅ framework-agnostic manual span API (`startRun`)
> · ✅ self-host packaging (Dockerfile, docker-compose, `docs/SELF_HOSTING.md`).

- **Coverage (#1):** abstract capture beyond Vercel-AI-SDK+Groq.
  - The `wrapLanguageModel` layer is already provider-agnostic *within* the AI SDK → add OpenAI/Anthropic/Bedrock model adapters for replay (`/api/replay` currently groq-only; generalise the provider switch).
  - Add an **OTel span exporter → `/api/ingest` adapter** (our wire format is already OTel-shaped) so LangGraph/CrewAI/custom loops can emit traces without our SDK. This is the single biggest TAM unlock.
  - Add a **framework-agnostic manual span API** (`runback.span(...)`) for anything else.
- **Data controls (#4):** a **PII/secret redaction hook in the SDK** that runs *before* events leave the process (redact prompt/message/tool-IO by regex + allowlist). This single feature de-risks *every* later product through security review.
- **Self-host packaging (#4):** it already self-hosts (Next + Postgres). Ship a `docker-compose` + Helm chart + "Deploy to your own infra" docs. Make self-host a marketed first-class path, not an afterthought.
- **API-key scoping:** per-project keys with read/write scopes (table already exists).

*Exit:* a LangGraph+OpenAI agent traces into Runback with PII redacted, self-hosted via one command.

### Phase 1 — Eval (creates the sticky asset; seeds #3, #5, #6) · ~4–6 wks
Turn captured runs into test suites. This is where lock-in begins.

- **Capture → dataset:** "Save this run/step as a test case" from the debugger UI. New tables: `ad_datasets`, `ad_dataset_items` (each item = a captured request + expected output/assertion).
- **Scorers:** exact-match, contains, JSON-shape, **tool-call assertion** ("must call `send_email` with valid `to`"), **goal-reached LLM-judge**, latency/cost budgets.
- **Eval run = replay × dataset + scorers.** Reuse `/api/replay` over every item, score outputs, store in `ad_eval_runs` / `ad_scores`. Compare prompt/model versions side-by-side (the replay-compare UI already exists — generalise it from 1 step to N).
- **Why it's the moat seed (#6):** accumulated datasets + baselines become the team's institutional memory. Ripping out Runback = losing your test suite.

*Exit:* a 20-case dataset built from real failures runs against two models and produces a scored diff.

### Phase 2 — Monitor (the daily value; produces #5) · ~4–6 wks
Always-on, the layer that earns recurring budget.

- **Rollups:** `ad_metrics_rollup` (failure rate, p50/p95 latency, token cost, tool-error rate, per-model/per-agent, over time). Ingest already recomputes per-run aggregates — extend to time-bucketed rollups.
- **Dashboards:** `/monitor` — failure-rate trend, cost trend, top error types, **behavioral-drift detection** (flag when failure/output distribution shifts after a model/prompt change — the "one update from breaking" problem from the gaps research).
- **Alerting:** Slack/webhook/email on failure-rate spike, new error class, latency/cost regression, drift. New table `ad_alerts`.
- **#5 falls out of this:** instrument a design-partner's agent for 30 days → "caught N regressions, cut MTTR from X to Y." That's the case study.

*Exit:* a live dashboard + a Slack alert fired on a real failure-rate spike.

### Phase 3 — Gate (highest WTP; clears #3, hardens #6) · ~2–3 wks (rides on Phase 1)
The thing teams actually pay for.

- **GitHub Action:** on PR, run the eval dataset, diff scores vs the baseline (last main run), comment the result table on the PR, **fail the check on regression**.
- **Promotion gate:** block a prod deploy if eval score drops below threshold.
- **#6 workflow lock-in:** once the gate is in the deploy critical path, removal = re-architecting CI. Hardest moat to rip out.

*Exit:* a PR that worsens the agent gets a red check + an inline regression report.

### Phase 4 — Enterprise & moat depth (clears #4-full, #6) · ongoing / quarters
- SSO (SAML/OIDC), RBAC, audit logs, SOC2 Type II process, data-retention policy controls, self-host parity + support SLA.
- **Capture-fidelity moat:** full deterministic replay across providers + exact cross-provider context reconstruction — the thing incumbents can't trivially copy because they didn't design capture for it.
- **Data network effect:** optional shared benchmark corpora / public eval leaderboards.

---

## Requirement → phase traceability

| CRO requirement | Cleared in | How |
|---|---|---|
| **#1 Coverage** (my framework + models) | Phase 0 | OTel ingest adapter + multi-provider replay + manual span API |
| **#2 Always-on monitor + alerting** | Phase 2 | rollups + `/monitor` dashboards + Slack/webhook alerts |
| **#3 CI regression gate** | Phase 3 | GitHub Action runs eval, diffs baseline, blocks PR |
| **#4 Enterprise trust** | Phase 0 (redaction, self-host, scoping) → Phase 4 (SSO/RBAC/SOC2) | de-risk capture early; full controls later |
| **#5 ROI case study** | Phase 2 + design-partner motion (starts Phase 1) | 30-day pilot → MTTR/regressions-caught number |
| **#6 A moat I can't copy** | built across all phases | SDK distribution (P0) · capture fidelity (P0/1) · data network effect / datasets (P1) · workflow lock-in (P3) |

**On #6 specifically — no single moat is enough; build three deliberately:**
1. *SDK distribution + capture fidelity* — own the instrumentation pipe; capture richer than competitors can replicate.
2. *Data network effect* — accumulated eval datasets + regression baselines = institutional memory.
3. *Workflow lock-in* — the CI gate sits in the deploy critical path.
Combined, defensible. The plan builds all three on purpose.

---

## Fastest path to first revenue

Don't wait for the full platform. The sharpest paid wedge is **the Gate sold as
"CI regression testing for AI agents,"** bolted onto the debug+replay you already
have. Sequence for *dollars* (not feature-completeness):

**Phase 0 → Phase 1 → Phase 3 (first paid product) → Phase 2 → Phase 4.**

- Debug stays free and drives capture/adoption.
- Eval (P1) + Gate (P3) = the first paid SKU: *"never ship an agent regression
  again."* Teams already feel deploy-fear — that's an existing budget line
  (they're paying for it in incidents today).
- Monitor (P2) becomes the second paid SKU and the case-study factory.

Recruit **2–3 design partners** at the start of Phase 1 (friendly teams shipping
agents). They populate real datasets, validate scorers, and produce the #5 number.
No design partners → no case study → no enterprise sale.

---

## Pricing (directional)

| | Free | Team (~$40–80/seat/mo or usage) | Enterprise (custom) |
|---|---|---|---|
| Debug + replay | ✅ | ✅ | ✅ |
| Eval / datasets | self-host only | ✅ hosted | ✅ |
| Monitor + alerts | — | ✅ | ✅ + drift |
| CI Gate | — | limited | ✅ unlimited |
| SSO / RBAC / SOC2 / self-host support | — | — | ✅ |

---

## Honest caveats (the CRO would still push back on)

- **Time-to-revenue is 9–15 months**, not a quick passive-SaaS flip. This remains
  the weakest time-to-revenue fit in the portfolio; the offset is a far larger TAM
  and a real platform outcome.
- **Incumbents are funded and adjacent.** LangSmith/Langfuse/Arize can move into
  any one phase. The bet is that *capture-fidelity + replay-grade eval + the
  integrated gate*, shipped fast bottoms-up, is a sharper bundle than their
  retrofits. Speed and focus are the only edge.
- **Design partners are non-negotiable.** Without 2–3 real agent teams, this is a
  beautiful platform nobody validated.

---

## Recommended first build

**Phase 0, starting with the two highest-leverage items:**
1. **OTel ingest adapter** (multi-framework coverage — biggest TAM unlock, #1).
2. **SDK redaction hook** (clears the security objection that blocks *every* paid tier, #4).

Both are small, both unblock everything downstream, and both are pure additions to
the existing `packages/sdk` + `web/app/api/ingest` with no rewrite.
