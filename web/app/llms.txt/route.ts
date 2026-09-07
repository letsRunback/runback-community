import { allBlogPostsSortedByDate } from "@/lib/blogPosts";
import { COMPETITORS } from "@/lib/competitors";

export const runtime = "nodejs";
export const revalidate = 3600;

const BASE = "https://runback.dev";

// llms.txt convention (https://llmstxt.org): a plain-markdown summary an LLM
// can read directly instead of crawling/rendering the full site. Kept in
// sync with BLOG_POSTS / COMPETITORS so it never drifts from what's live.
export async function GET() {
  const posts = allBlogPostsSortedByDate();
  const competitorLinks = Object.entries(COMPETITORS)
    .map(([slug, c]) => `- [${c.name} vs Runback](${BASE}/vs/${slug}): ${c.gap}`)
    .join("\n");
  const blogLinks = posts
    .map((p) => `- [${p.title}](${BASE}/blog/${p.slug}): ${p.description}`)
    .join("\n");

  const body = `# Runback

> The system of record for AI agents. Captures every decision an AI agent makes — the full context window, tool calls, and results at every step — then lets you replay any step from the exact captured request, gate a model or prompt change in CI before it ships, and export a signed, tamper-evident audit record.

Runback is not a read-only trace viewer (unlike LangSmith, Langfuse, Helicone, Braintrust, Arize, Traceloop, or Portkey). Its core differentiators: replay-from-step-N (re-issue or edit any captured LLM request and see how the model responds differently), a CI release gate that blocks a regression before deploy, and a hash-chained signed audit export that verifies independently of Runback.

Runback is proprietary software with a free, self-hostable Community edition (core capture/replay/audit/evals, single workspace) and a licensed Enterprise edition (multi-tenant, RBAC, SSO, alerting, long retention). See ${BASE}/pricing.

## Product

- [How it works](${BASE}/how-it-works): the capture -> replay -> gate -> audit pipeline, and the case for re-execution over observability
- [Integrations](${BASE}/integrations): Vercel AI SDK, OpenTelemetry (LangChain, CrewAI, LlamaIndex, raw SDKs)
- [Docs](${BASE}/docs): quickstart, SDK reference, self-host guide, full API
- [Pricing](${BASE}/pricing): free Community edition through Enterprise
- [Live demo](${BASE}/runs): open a real failing run, no signup
- [Get started free](${BASE}/get-started): a workspace in minutes, or the live demo with no signup

## Trust and verification

- [Security](${BASE}/security): self-hosting, data residency, redaction, what's shipped vs. not yet certified
- [Spec](${BASE}/spec): the runback.cassette/v1 audit record format, independently verifiable
- [Verify a record](${BASE}/verify): the open-source \`@runback/verify\` CLI (MIT, npm, zero network calls) — check any cassette's integrity and signature without an account
- [Transparency log](${BASE}/transparency): the public, append-only feed of every sealed ledger checkpoint across every workspace — paste a log id to check one
- [Changelog](${BASE}/changelog): Runback's own release history, hash-chained the same way the product seals a customer's audit trail
- [Procurement / Trust Center](${BASE}/procurement): regulatory mapping, CAIQ-lite answers, and a machine-readable version at ${BASE}/api/procurement

## Regulatory frameworks

Live, clause-by-clause maps from seven regulatory frameworks to the exact Runback capability and evidence behind each — computed from the same engine the in-app Regulatory tab evaluates against real customer data, not static marketing copy.

- [EU AI Act Article 12](${BASE}/eu-ai-act): hand-assessed, supplied/partial/yours per clause
- [All seven frameworks](${BASE}/regulatory): EU AI Act, ISO/IEC 42001, NIST AI RMF, APRA CPS 230, APRA CPS 234, GDPR, ISO/IEC 27001

## Compare

${competitorLinks}

## Engineering blog

${blogLinks}

## Other

- [RSS feed](${BASE}/feed.xml)
- [Determinism proofs (public CI)](https://github.com/letsRunback/runback-proofs)
- [@runback/verify on npm](https://www.npmjs.com/package/@runback/verify): MIT-licensed, zero dependencies, independently recomputes the hash chain and signature
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
