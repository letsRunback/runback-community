/**
 * Regression coverage for a real bug found by direct investigation:
 * createPost()'s GraphQL mutation returned a clean success with a real-
 * looking post id, and that post did not exist in Buffer at all — querying
 * it back returned "Post not found for id: …". The signal had already been
 * marked processed in our own database, so the post was lost with no error
 * anywhere and no way to retry it. verifyPost() is the fix's building
 * block: re-query the post after creation before trusting it was delivered.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { verifyPost, waitForPost } from "@/lib/buffer";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

function jsonResponse(body: unknown, ok = true) {
  return { ok, status: ok ? 200 : 500, json: async () => body, text: async () => JSON.stringify(body) };
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("verifyPost", () => {
  it("reports exists:false for a post Buffer says it can't find", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ errors: [{ message: "Post not found for id: abc123" }] })
    );
    const result = await verifyPost("token", "abc123");
    expect(result.exists).toBe(false);
  });

  it("reports exists:true for a post Buffer confirms", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { post: { id: "abc123", status: "sent", error: null } } })
    );
    const result = await verifyPost("token", "abc123");
    expect(result.exists).toBe(true);
    expect(result.status).toBe("sent");
    expect(result.error).toBeUndefined();
  });

  it("surfaces a publishing error even when the post exists", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ data: { post: { id: "abc123", status: "failed", error: { message: "image fetch timed out" } } } })
    );
    const result = await verifyPost("token", "abc123");
    expect(result.exists).toBe(true);
    expect(result.error).toBe("image fetch timed out");
  });

  it("treats a network failure as not verified, not as a crash", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await verifyPost("token", "abc123");
    expect(result.exists).toBe(false);
    expect(result.error).toMatch(/network down/);
  });
});

describe("waitForPost", () => {
  it("stops polling as soon as the post is found to exist, not on the first check", async () => {
    // Not found for the first two checks, then it shows up — the exact
    // shape of "Buffer is still processing it", which a single check right
    // after creation can't tell apart from a genuine, permanent failure.
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Post not found for id: abc123" }] }))
      .mockResolvedValueOnce(jsonResponse({ errors: [{ message: "Post not found for id: abc123" }] }))
      .mockResolvedValueOnce(jsonResponse({ data: { post: { id: "abc123", status: "sent", error: null } } }));

    const result = await waitForPost("token", "abc123", { attempts: 9, intervalMs: 0 });
    expect(result.exists).toBe(true);
    expect(result.status).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(3); // did not keep polling past the successful check
  });

  it("gives up as not-found only after exhausting every attempt", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ errors: [{ message: "Post not found for id: abc123" }] }));
    const result = await waitForPost("token", "abc123", { attempts: 4, intervalMs: 0 });
    expect(result.exists).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("stops as soon as the post exists even if it carries a publishing error, rather than treating that as 'keep waiting'", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ data: { post: { id: "abc123", status: "failed", error: { message: "image fetch timed out" } } } })
    );
    const result = await waitForPost("token", "abc123", { attempts: 9, intervalMs: 0 });
    expect(result.exists).toBe(true);
    expect(result.error).toBe("image fetch timed out");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
