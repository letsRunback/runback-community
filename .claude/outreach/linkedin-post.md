# LinkedIn post — for founder account

**When to post:** Tuesday morning, 8–9am in your timezone
**Format:** Short paragraphs, no headers, no bullet lists (LinkedIn penalises them)
**Goal:** Shares from compliance/risk professionals, newsletter signups

---

## Post option A — The incident story (highest engagement)

A bank's loan-approval agent made an inconsistent decision.

The team had logs. They had traces. They had a whole war room.

Three hours later, they still couldn't reproduce what happened — because the model had seen different retrieved documents the second time, and nobody had captured the exact context it saw the first time.

That's the gap traditional observability doesn't close. Logs record the outcome. Only a re-executable run shows you the reasoning.

We built Runback for exactly this: capture every decision context, re-execute it from the exact captured state, seal the cassette for the auditor.

If you're running AI agents in financial services, legal, or any regulated context — the question you'll be asked isn't "did you use AI?" It's "can you show what it saw and what it decided?"

runback.dev/runs — open a real incident and replay it yourself. No signup.

---

## Post option B — The regulatory angle (good for compliance audience)

EU AI Act Article 12 enforcement started this week.

High-risk AI systems — which includes lending, fraud detection, employment screening, and any consequential autonomous decision — must now keep automatic event logs over their operational lifetime.

Most teams I've spoken with have the same response: "we have logs."

Logs record what happened. They don't record what the model saw — the retrieved documents, the exact messages[] array, the tool outputs that shaped the decision. A regulator asking to reproduce a specific decision from 18 months ago needs more than a log.

Runback is built for this gap. Every agent decision captured, chained, signed, re-executable. The export your auditor actually asks for.

If you're not ready, runback.dev/enterprise has the control mapping for EU AI Act, APRA CPS 230, and NIST AI RMF.

---

## Post option C — The developer angle (for tech/AI audience)

Three things I learned building AI agent observability:

1. You can't reproduce a failing agent from a log. The model's decision is a function of what it saw — retrieved documents, tool outputs, the exact messages[] array. A trace records the outcome. A re-executable run shows the reasoning.

2. Policy enforcement needs to run before the tool executes, not after. If a refund agent issues $2,000 to an unverified account, logging that event is too late. The gate needs to fire before the call.

3. The audit artifact that actually matters is re-runnable. Signing a log proves it wasn't altered. Re-executing a decision proves what actually happened. For a regulator, only the second matters.

We shipped Runback to solve all three. Three lines to instrument any TypeScript agent. Self-hostable in your own VPC.

npm install @runback/sdk
runback.dev/docs

---

## Hashtags (add to any post)
#AIGovernance #AIAct #APRA #AgentAI #LLM #Compliance #FinTech #LegalTech
