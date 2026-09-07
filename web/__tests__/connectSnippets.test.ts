/**
 * The onboarding snippets are the first thing a new user runs. A snippet that
 * does not validate is a dead first impression — and that is exactly what
 * shipped: the cURL tab sent `{name, status, output}`, which fails
 * ingestPayloadSchema with 422 and could never have worked.
 *
 * These tests pin the wire format the snippets teach to the schema the ingest
 * route actually enforces, so the two cannot drift apart again.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { ingestPayloadSchema } from "@runback/schema";

const SNIPPET_FILE = join(__dirname, "../app/app/ConnectSnippet.tsx");
const src = readFileSync(SNIPPET_FILE, "utf8");

/**
 * Extract the JSON body the cURL snippet POSTs, resolving the two shell
 * variables it interpolates. Mirrors what a user's shell would produce.
 */
function curlBody(): unknown {
  const start = src.indexOf(`-d '{"events":[`);
  expect(start, "cURL snippet no longer contains an -d '{\"events\":[ body").toBeGreaterThan(-1);
  const open = src.indexOf("'", start + 3) + 1;
  const close = src.indexOf("'\n", open);
  const raw = src
    .slice(open, close)
    // The snippet closes/reopens the single-quoted string to splice in shell
    // vars: '"$RID"' — substitute concrete values a shell would supply.
    .replace(/'"\$RID"'/g, "hello-1785110000")
    .replace(/'"\$TS"'/g, "2026-07-27T10:00:00.000Z");
  return JSON.parse(raw);
}

describe("onboarding connect snippets", () => {
  it("the cURL snippet body validates against the real ingest schema", () => {
    const parsed = ingestPayloadSchema.safeParse(curlBody());
    expect(
      parsed.success ? null : JSON.stringify(parsed.error.issues, null, 2)
    ).toBeNull();
  });

  it("the cURL snippet sends a complete run — a start and an end envelope", () => {
    const body = curlBody() as { events: { type: string; phase?: string }[] };
    const runEvents = body.events.filter((e) => e.type === "run");
    expect(runEvents.map((e) => e.phase)).toEqual(["start", "end"]);
  });

  it("does not offer a Python SDK — no such package exists on PyPI or in this repo", () => {
    // Python users are routed to the OTel tab, which genuinely works.
    expect(src).not.toMatch(/from runback import/);
  });

  it("only npm-installs packages this repo actually publishes", () => {
    // The original form of this test asserted the SDK install line was ABSENT,
    // because @runback/sdk was `private: true` and shipped raw TypeScript from
    // src/ — the documented install was a github: URL that fails for anyone
    // outside the org. The package is now built and published, so the guard
    // inverts: the snippet may say `npm install @runback/sdk`, but only for as
    // long as that package remains publishable.
    const installs = [...src.matchAll(/npm install (@runback\/[a-z-]+)/g)].map((m) => m[1]);

    for (const pkg of installs) {
      const dir = pkg.replace("@runback/", "");
      const manifest = JSON.parse(
        readFileSync(join(__dirname, `../../packages/${dir}/package.json`), "utf8")
      );
      expect(manifest.name, `${pkg} must exist in packages/${dir}`).toBe(pkg);
      expect(manifest.private, `${pkg} is advertised but marked private`).not.toBe(true);
      // A published entry point must point at build output, not TypeScript source:
      // consumers cannot import .ts.
      expect(manifest.main, `${pkg} main must not be raw TS`).not.toMatch(/\.tsx?$/);
    }
  });

  it("the OTel endpoint matches the route that actually exists", () => {
    // Exporters append /v1/traces, so the configured endpoint must be the
    // parent of app/api/otel/v1/traces/route.ts. The base is the page's own
    // origin (not a hardcoded runback.dev) — see ConnectSnippet.tsx's baseUrl
    // state — so this asserts the /api/otel suffix against that variable.
    expect(src).toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT=\$\{base\}\/api\/otel\b/);
    expect(src).not.toMatch(/OTLP_ENDPOINT=\S*\/api\/otel\/v1\/traces/);
    expect(src).not.toMatch(/OTEL_EXPORTER_OTLP_ENDPOINT=https:\/\/runback\.dev/);
  });

  it("does not hardcode runback.dev as the ingest/quickstart base URL", () => {
    // Self-hosted deployments must never have their onboarding snippets point
    // at the hosted SaaS — see docs/SELF_HOSTING.md's Privacy posture section
    // ("No product telemetry leaves your network"). The cURL and quickstart
    // lines must use the runtime-derived `base`, not a literal runback.dev URL.
    expect(src).not.toMatch(/curl -X POST https:\/\/runback\.dev\/api\/ingest/);
    expect(src).not.toMatch(/curl -fsSL https:\/\/runback\.dev\/api\/quickstart/);
  });
});
