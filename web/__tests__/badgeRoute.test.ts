import { describe, it, expect, vi, beforeEach } from "vitest";

const logSummary = vi.fn();
vi.mock("@/lib/transparency", () => ({ logSummary }));

describe("GET /api/badge/[logId]", () => {
  beforeEach(() => {
    logSummary.mockClear();
  });

  it("renders a sealed-count badge for a real log_id with entries", async () => {
    logSummary.mockResolvedValue({
      count: 142,
      latest: { published_at: new Date(Date.now() - 3 * 3600_000).toISOString() },
    });
    const { GET } = await import("../app/api/badge/[logId]/route");
    const req = new Request("http://x/api/badge/rbl_aaaaaaaaaaaaaaaaaaaaaaaa.svg");
    const res = await GET(req as never, { params: Promise.resolve({ logId: "rbl_aaaaaaaaaaaaaaaaaaaaaaaa.svg" }) });
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
    const svg = await res.text();
    expect(svg).toContain("142 sealed");
    expect(svg).toContain("3h ago");
    expect(svg).toContain("<svg");
  });

  it("renders a neutral badge when the log_id has no checkpoints yet", async () => {
    logSummary.mockResolvedValue({ count: 0, latest: null });
    const { GET } = await import("../app/api/badge/[logId]/route");
    const req = new Request("http://x/api/badge/rbl_bbbbbbbbbbbbbbbbbbbbbbbb.svg");
    const res = await GET(req as never, { params: Promise.resolve({ logId: "rbl_bbbbbbbbbbbbbbbbbbbbbbbb.svg" }) });
    const svg = await res.text();
    expect(svg).toContain("no checkpoints yet");
    expect(logSummary).toHaveBeenCalledWith("rbl_bbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("rejects a log_id that doesn't match the real format instead of querying the database with it", async () => {
    const { GET } = await import("../app/api/badge/[logId]/route");
    const req = new Request("http://x/api/badge/not-a-real-id.svg");
    const res = await GET(req as never, { params: Promise.resolve({ logId: "not-a-real-id.svg" }) });
    expect(res.status).toBe(400);
    const svg = await res.text();
    expect(svg).toContain("invalid id");
    expect(logSummary).not.toHaveBeenCalled();
  });

  it("never exposes org_id — only ever queries by the opaque log_id from the URL", async () => {
    logSummary.mockResolvedValue({ count: 5, latest: { published_at: new Date().toISOString() } });
    const { GET } = await import("../app/api/badge/[logId]/route");
    const req = new Request("http://x/api/badge/rbl_cccccccccccccccccccccccc.svg");
    await GET(req as never, { params: Promise.resolve({ logId: "rbl_cccccccccccccccccccccccc.svg" }) });
    expect(logSummary).toHaveBeenCalledTimes(1);
    expect(logSummary).toHaveBeenCalledWith("rbl_cccccccccccccccccccccccc");
  });
});
