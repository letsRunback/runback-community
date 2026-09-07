/**
 * Deliver a real message to a real SMTP server.
 *
 * Air-gapped and on-prem deployments cannot reach Resend's REST API, and every
 * such site has an internal relay instead. A mocked test would only prove that
 * a function was called; what has to be true is that a server speaking SMTP
 * accepts what we send, with the envelope and body intact.
 *
 * This runs a minimal SMTP server on loopback — enough of RFC 5321 for a
 * nodemailer session — and asserts on the bytes it received.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { createServer, type Server, type Socket } from "node:net";
import type { AddressInfo } from "node:net";

let server: Server;
let port: number;
/** Full transcripts of every session, for asserting what was actually sent. */
const sessions: string[] = [];

beforeAll(async () => {
  server = createServer((sock: Socket) => {
    let buf = "";
    let inData = false;
    let transcript = "";
    sock.write("220 relay.test ESMTP\r\n");
    sock.on("data", (chunk) => {
      buf += chunk.toString();
      transcript += chunk.toString();
      for (;;) {
        const i = buf.indexOf("\r\n");
        if (i < 0) break;
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            sock.write("250 2.0.0 Ok: queued\r\n");
          }
          continue;
        }
        const cmd = line.split(" ")[0].toUpperCase();
        if (cmd === "EHLO" || cmd === "HELO") sock.write("250-relay.test\r\n250 8BITMIME\r\n");
        else if (cmd === "MAIL" || cmd === "RCPT") sock.write("250 2.1.0 Ok\r\n");
        else if (cmd === "DATA") { inData = true; sock.write("354 End data with <CR><LF>.<CR><LF>\r\n"); }
        else if (cmd === "QUIT") { sock.write("221 2.0.0 Bye\r\n"); sock.end(); }
        else sock.write("250 2.0.0 Ok\r\n");
      }
    });
    // Record on close, not on QUIT: nodemailer may drop the connection without
    // one, and the assertion would then race the transcript.
    sock.on("close", () => { if (transcript) sessions.push(transcript); });
    sock.on("error", () => {});
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const VARS = ["RUNBACK_SMTP_URL", "RESEND_API_KEY", "LEAD_NOTIFY_FROM"];
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  sessions.length = 0;
  for (const v of VARS) { saved[v] = process.env[v]; delete process.env[v]; }
});
afterEach(() => {
  for (const v of VARS) {
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
  }
});

describe("SMTP delivery", () => {
  it("delivers a magic link through an internal relay with no auth", async () => {
    // No credentials in the URL: the common shape inside a corporate network.
    process.env.RUNBACK_SMTP_URL = `smtp://127.0.0.1:${port}`;
    process.env.LEAD_NOTIFY_FROM = "Runback <runback@corp.internal>";
    const { sendMagicLink } = await import("@/lib/email");

    const ok = await sendMagicLink("engineer@corp.internal", "https://runback.corp.internal/auth/confirm?t=abc");
    expect(ok).toBe(true);

    await new Promise((r) => setTimeout(r, 50));
    expect(sessions.length).toBe(1);
    const t = sessions[0];
    expect(t).toContain("RCPT TO:<engineer@corp.internal>");
    expect(t).toContain("MAIL FROM:<runback@corp.internal>");
    // The link is the entire point of the message; quoted-printable may fold
    // long lines, so assert on a distinctive unbroken fragment.
    expect(t).toContain("runback.corp.internal");
  });

  it("wins over a Resend key present in the same environment", async () => {
    // An on-prem image built from the hosted config can easily carry a stale
    // RESEND_API_KEY. Setting an SMTP URL has to be unambiguous.
    process.env.RUNBACK_SMTP_URL = `smtp://127.0.0.1:${port}`;
    process.env.RESEND_API_KEY = "re_should_never_be_used";
    const { sendMagicLink } = await import("@/lib/email");

    expect(await sendMagicLink("a@corp.internal", "https://x.internal/l")).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(sessions.length).toBe(1);
  });

  it("returns false rather than throwing when the relay is unreachable", async () => {
    // Callers treat false as "not sent" and fall back; an exception here would
    // 500 the sign-in route instead of printing the link to the log.
    process.env.RUNBACK_SMTP_URL = "smtp://127.0.0.1:1";
    const { sendMagicLink } = await import("@/lib/email");
    await expect(sendMagicLink("a@corp.internal", "https://x.internal/l")).resolves.toBe(false);
  });

  it("still reports not-sent when nothing at all is configured", async () => {
    const { sendMagicLink } = await import("@/lib/email");
    expect(await sendMagicLink("a@corp.internal", "https://x.internal/l")).toBe(false);
  });
});
