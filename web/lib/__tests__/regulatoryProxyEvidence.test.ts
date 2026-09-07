/**
 * Proxy evidence must never reach "compliant".
 *
 * computeControlStatus resolves a status per evidence TYPE and then assigns it
 * to every control sharing that type. Two of those types — "audit_log" and
 * "report" — are computed from a plain run count, which is evidence that
 * capture is working and nothing else. At >=10 and >=5 runs respectively they
 * returned "compliant", which marked as fully met:
 *
 *   cps234-testing  "Golden test suite + Upgrade gate"   with zero golden tests
 *   iso-10-2        "incident-to-test auto-enroll"       with nothing enrolled
 *   gdpr-art-32     "SSO + policy engine + audit trail"  with SSO off
 *   iso-9-3 / cps230-review  "management/board review"   from five captured runs
 *
 * None of those capabilities is read by the query that decided them. The result
 * feeds getControlEvidenceSample(), the sealed compliance narrative and the
 * exportable evidence pack — so an auditor receives the proxy verdict as
 * though it were a finding.
 *
 * Source-level for the same reason as the ledger guard: this codebase does not
 * unit-mock Supabase builders, and the failure is a plausible wrong answer
 * rather than an error.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const SRC = join(__dirname, "..", "enterprise", "regulatory.ts");
const present = existsSync(SRC);
const src = present ? readFileSync(SRC, "utf8") : "";

/** The body of the branch handling a given evidence type. */
function branchFor(type: string): string {
  const start = src.search(new RegExp(`if \\(evidenceType === "${type}"`));
  if (start === -1) return "";
  const rest = src.slice(start);
  const next = rest.slice(1).search(/if \(evidenceType ===/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

describe.skipIf(!present)("regulatory proxy evidence", () => {
  it("locates the proxy branch (guard against a vacuous test)", () => {
    expect(branchFor("audit_log").length).toBeGreaterThan(100);
  });

  it("audit_log and report never return compliant", () => {
    // They share one branch today; if they are ever split again, both are checked.
    for (const type of ["audit_log", "report"]) {
      const b = branchFor(type);
      if (!b) continue;
      expect(b, `${type} is a run-count proxy and must not claim "compliant"`)
        .not.toMatch(/"compliant"/);
    }
  });

  it("the types that ARE genuinely computed can still reach compliant", () => {
    // The cap must not have been applied indiscriminately — these read the
    // thing they claim, so withholding "compliant" from them would understate
    // a real control just as badly as the over-claim understated nothing.
    for (const type of ["policy_block", "ledger", "redaction"]) {
      const b = branchFor(type);
      expect(b, `${type} should still be able to report compliant`).toMatch(/"compliant"/);
    }
  });

  it("the ledger branch still gates compliant on verification", () => {
    expect(branchFor("ledger")).toMatch(/intact/);
  });
});
