import { tool } from "ai";
import { z } from "zod";

/**
 * A tiny mock corpus so the demo runs deterministically without external APIs.
 * Real Runback users would wrap their real tools — the instrumentation is identical.
 */
const CORPUS: Record<string, { title: string; url: string; snippet: string }[]> =
  {
    "next.js 16": [
      {
        title: "Next.js 16 Release Notes",
        url: "https://nextjs.org/blog/next-16",
        snippet:
          "Next.js 16 makes `params` and `searchParams` async (Promises), stabilizes Cache Components, and ships Turbopack as the default bundler.",
      },
      {
        title: "Upgrading to Next.js 16",
        url: "https://nextjs.org/docs/app/guides/upgrading/version-16",
        snippet:
          "Await dynamic params in pages and route handlers. The `RouteContext<'/path'>` helper types the params Promise.",
      },
    ],
  };

export const webSearch = tool({
  description:
    "Search the web for up-to-date information. Returns a list of result snippets.",
  inputSchema: z.object({
    query: z.string().describe("The search query"),
  }),
  execute: async ({ query }) => {
    const key = Object.keys(CORPUS).find((k) =>
      query.toLowerCase().includes(k)
    );
    const results = key
      ? CORPUS[key]
      : [
          {
            title: "No strong match",
            url: "https://example.com",
            snippet: `No curated results for "${query}". Summarize from general knowledge.`,
          },
        ];
    return { results };
  },
});

export const fetchUrl = tool({
  description: "Fetch the readable text content of a URL.",
  inputSchema: z.object({
    url: z.string().describe("The URL to fetch"),
  }),
  execute: async ({ url }) => {
    // Mock page bodies keyed by URL substring.
    if (url.includes("next-16")) {
      return {
        url,
        content:
          "Next.js 16 highlights: async params/searchParams, Cache Components stable, Turbopack default, React 19.2 support, and improved `use cache` semantics.",
      };
    }
    return { url, content: `(mock) Fetched ${url}. No detailed body available.` };
  },
});

/**
 * Intentionally strict: throws on a malformed recipient. The demo task passes a
 * deliberately broken address so the run fails at this step — exactly the
 * "stare at 400 lines of logs" moment Runback is built to collapse into one click.
 */
export const sendEmail = tool({
  description:
    "Send an email. `to` must be a valid RFC-5322 address (e.g. name@domain.com).",
  inputSchema: z.object({
    to: z.string().describe("Recipient email address"),
    subject: z.string(),
    body: z.string(),
  }),
  execute: async ({ to, subject, body }) => {
    const valid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to);
    if (!valid) {
      throw new Error(
        `SMTP 550: invalid recipient address "${to}". Expected a valid email like name@domain.com.`
      );
    }
    return {
      delivered: true,
      to,
      subject,
      bytes: body.length,
    };
  },
});

export const tools = {
  web_search: webSearch,
  fetch_url: fetchUrl,
  send_email: sendEmail,
};
