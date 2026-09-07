/**
 * The ledger control must be decided by verification, not by a row count.
 *
 * It reported `ledgerCount > 0 ? "compliant" : "not_started"` — so an org whose
 * hash chain FAILED verification still exported an auditor-facing package
 * attesting to "tamper-evident run records", while /app/ledger showed a tamper
 * panel for the same org. EU AI Act Art.12 and its ISO/NIST equivalents are
 * satisfied by a record that can be shown to be unaltered; having rows is not
 * that. An evidence package claiming integrity it never checked is worse than
 * one reporting a failure, because only the failure is actionable.
 *
 * Source-level, because this codebase does not unit-mock Supabase query
 * builders (see regulatory.test.ts) and the regression is invisible at
 * runtime: the wrong answer is a plausible "compliant", not an error.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// enterprise/regulatory.ts is commercially licensed and absent from the
// Community build, where there is no regulatory surface to guard. skipIf, not
// an entry in scripts/community-exclude.txt: the check belongs to the file it
// guards, and dropping the test file separately would let the two drift.
const SRC = join(__dirname, "..", "enterprise", "regulatory.ts");
const present = existsSync(SRC);
const src = present ? readFileSync(SRC, "utf8") : "";
// Bounded by the NEXT evidence-type branch, whatever it is, rather than by a
// named one. The end marker was `if (evidenceType === "audit_log")`; merging
// audit_log with report changed that line, the marker stopped matching, and the
// slice silently ran on into the redaction branch — so the test failed against
// code it was never meant to be reading. A structural boundary cannot rot that
// way when a neighbouring branch is edited.
const ledgerBranch = src.slice(src.indexOf('if (evidenceType === "ledger")'));
const nextBranch = ledgerBranch.slice(1).search(/if \(evidenceType ===/);
const branch = nextBranch === -1 ? ledgerBranch : ledgerBranch.slice(0, nextBranch + 1);

describe.skipIf(!present)("regulatory ledger control", () => {
  it("locates the ledger branch (guard against a vacuous test)", () => {
    expect(branch.length).toBeGreaterThan(200);
    expect(branch).toContain("ledgerCount");
  });

  it("calls verifyLedger rather than deciding on the count alone", () => {
    expect(branch, "the ledger control must verify the chain").toMatch(/verifyLedger\(/);
  });

  it("never returns compliant without intact === true", () => {
    // Every `"compliant"` in the branch must be guarded by an intact check.
    const compliantLines = branch
      .split("\n")
      .filter((l) => l.includes('"compliant"') && !l.trim().startsWith("//"));
    expect(compliantLines.length).toBeGreaterThan(0);
    for (const line of compliantLines) {
      expect(line, `"compliant" decided without checking intact: ${line.trim()}`).toMatch(/intact/);
    }
  });

  it("treats an unverifiable ledger as partial, not as a tamper finding", () => {
    // intact === null means the store was unreadable. Reporting that as a gap
    // would raise a false integrity alarm; reporting it as compliant would
    // hide one. Both are wrong.
    expect(branch).toMatch(/intact === false/);
    expect(branch).toMatch(/"partial"/);
  });
});
