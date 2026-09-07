/**
 * A key embedded in a customer's application should be able to send telemetry
 * and nothing else.
 *
 * Every `rb_live_` key resolves to role "admin" in getCaller(). That is the
 * most widely distributed credential Runback issues — it lives in every
 * instrumented app, every CI runner, every container image — and if it leaks
 * from a repository it carries admin over the workspace it belongs to.
 *
 * The "trace_write" scope is the fix, and it works by being rejected in one
 * place and accepted in another: resolveApiKey() (the ingest path) accepts it,
 * getCaller() (the general API) does not. Both halves have to hold or the
 * scope is either useless or a lockout, so both are asserted here.
 *
 * The historical "ingest" scope is deliberately unchanged — it drives the
 * documented CI release-gate and replay flows, and narrowing it silently would
 * break those for existing customers. That trade-off is asserted too, so it
 * stays a decision rather than becoming an accident.
 */
import { describe, it, expect } from "vitest";
import { INGEST_SCOPES, type ApiKeyScope } from "@/lib/apiKeys";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LIB = join(__dirname, "..");
const apiAuthSrc = readFileSync(join(LIB, "apiAuth.ts"), "utf8");
const ingestSrc = readFileSync(join(LIB, "ingest.ts"), "utf8");

describe("trace_write is accepted for ingest", () => {
  it("is an ingest scope", () => {
    expect(INGEST_SCOPES).toContain("trace_write" as ApiKeyScope);
  });

  it("so is the historical ingest scope — existing keys keep working", () => {
    expect(INGEST_SCOPES).toContain("ingest" as ApiKeyScope);
  });

  it("the ingest resolver gates on the list, not a single hard-coded scope", () => {
    // The check used to be `data.scope !== "ingest"`, which would reject
    // trace_write and turn every new SDK key into a silent 401.
    expect(ingestSrc).toMatch(/INGEST_SCOPES\.includes/);
    expect(ingestSrc).not.toMatch(/data\.scope\s*!==\s*"ingest"/);
  });

  it("does NOT admit the narrow single-purpose scopes", () => {
    for (const s of ["compliance_read", "security_findings", "scim"] as ApiKeyScope[]) {
      expect(INGEST_SCOPES).not.toContain(s);
    }
  });
});

describe("trace_write is refused by the general API", () => {
  it("getCaller admits only the historical ingest scope", () => {
    // This is the half that makes the scope write-ONLY. If getCaller ever
    // starts accepting trace_write, a leaked SDK key regains the whole API and
    // the scope becomes decorative.
    expect(apiAuthSrc).toMatch(/data\.scope\s*&&\s*data\.scope\s*!==\s*"ingest"/);
    expect(apiAuthSrc).not.toMatch(/INGEST_SCOPES/);
  });

  it("the two resolvers disagree on purpose", () => {
    // Stated as an assertion because it looks like an inconsistency to anyone
    // reading either file alone, and a future tidy-up that "fixes" it would
    // silently remove the isolation.
    const ingestAccepts = INGEST_SCOPES.includes("trace_write" as ApiKeyScope);
    const generalApiAccepts = /data\.scope\s*&&\s*!INGEST_SCOPES/.test(apiAuthSrc);
    expect(ingestAccepts).toBe(true);
    expect(generalApiAccepts).toBe(false);
  });
});
