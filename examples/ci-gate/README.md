# Runback CI release gate

> "No agent change ships unless its replay reproduces the baseline cassette."

Deterministic, offline, **zero model calls** — runs on every PR, even air-gapped.
The baseline digest equals the signed audit record's `cassette_digest`, so a green
gate is also a statement that the shipped agent still reproduces the audited
behaviour.

### 1. Express your agent as a replay body — `src/agent.replay.ts`

```ts
export default async function agentBody(play) {
  const lookup = play.tool("lookup_customer", realLookupCustomer); // wrap tools
  // ...your normal loop; fetch / new Date() / Math.random are auto-intercepted...
  const cust = await lookup(8842);
  return decide(cust);
}
```

### 2. Record a baseline once, from a known-good run

```ts
import { record } from "@runback/replay";
import { writeFileSync } from "node:fs";
import agentBody from "./src/agent.replay";

const { cassette } = await record("refund-agent", agentBody);
writeFileSync("./baselines/refund-agent.cassette.json", JSON.stringify(cassette, null, 2));
// cassette.digest === your signed audit record's manifest.replay.cassette_digest
```

### 3. Gate it in CI

Copy `runback-gate.yml` into `.github/workflows/`. On every PR it replays the
current agent against the baseline and **fails the build on any behaviour
change** — pinpointed to the exact interaction that diverged. Pass `--expect
<digest>` (from the signed audit) to also catch a swapped baseline.

### 4. Intentional change?

Re-record the baseline and re-sign the audit. The diff in the cassette digest is
itself the reviewable record of *what behaviour changed*.
