import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/**
 * Regression test for a real bug caught while adding the ?log= filter (for
 * the public status badge): verifyLogChain() assumes each entry's prev_hash
 * links to the PREVIOUS entry in the array, which is only true for the
 * unfiltered global feed. A log_id-filtered slice skips every other org's
 * interleaved entries, so running the same chain check against it would
 * report spurious breaks between two genuinely-fine entries that simply
 * aren't adjacent in the real chain — the opposite of what a transparency
 * log is for. Filtered requests must not claim chain_ok either way.
 */

const readLog = vi.fn();
const verifyLogChain = vi.fn();
vi.mock("@/lib/transparency", () => ({ readLog, verifyLogChain }));

describe("GET /api/transparency", () => {
  beforeEach(() => {
    readLog.mockClear();
    verifyLogChain.mockClear();
  });

  it("computes chain_ok on the unfiltered feed", async () => {
    readLog.mockResolvedValue([{ seq: 1, entry_hash: "a" }, { seq: 2, entry_hash: "b" }]);
    verifyLogChain.mockReturnValue({ ok: true, brokenAt: null });
    const { GET } = await import("../app/api/transparency/route");
    const req = new NextRequest("http://x/api/transparency");
    const res = await GET(req);
    const body = await res.json();
    expect(verifyLogChain).toHaveBeenCalled();
    expect(body.chain_ok).toBe(true);
    expect(body.chain_note).toBeUndefined();
  });

  it("does NOT compute chain_ok when filtered by log_id, and says why instead of guessing", async () => {
    readLog.mockResolvedValue([{ seq: 5, entry_hash: "x" }, { seq: 41, entry_hash: "y" }]);
    const { GET } = await import("../app/api/transparency/route");
    const req = new NextRequest("http://x/api/transparency?log=rbl_aaaaaaaaaaaaaaaaaaaaaaaa");
    const res = await GET(req);
    const body = await res.json();
    expect(verifyLogChain).not.toHaveBeenCalled();
    expect(body.chain_ok).toBeNull();
    expect(body.chain_broken_at).toBeNull();
    expect(body.chain_note).toMatch(/not adjacent in the real global chain/);
    expect(readLog).toHaveBeenCalledWith(0, 500, "rbl_aaaaaaaaaaaaaaaaaaaaaaaa");
  });
});
