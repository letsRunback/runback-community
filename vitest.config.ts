import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // .js as well as .ts: packages/verify is the plain-JS artifact published to
    // npm, and until this glob included .test.js it had no coverage in CI at all
    // — the one package outsiders actually run was the one nothing tested.
    include: [
      "packages/**/test/**/*.test.{ts,js}",
      "web/**/__tests__/**/*.test.{ts,js}",
    ],
    environment: "node",
  },
  resolve: {
    alias: {
      "@runback/schema": new URL("./packages/schema/src/index.ts", import.meta.url).pathname,
      "@runback/redact": new URL("./packages/redact/src/index.ts", import.meta.url).pathname,
      // Longest-prefix first: Vite matches string aliases in order, so a bare
      // "@runback/replay" entry placed above would also swallow
      // "@runback/replay/enterprise" and resolve it to the Community index.
      "@runback/replay/enterprise": new URL("./packages/replay/src/enterprise/index.ts", import.meta.url).pathname,
      "@runback/replay": new URL("./packages/replay/src/index.ts", import.meta.url).pathname,
      "@runback/policy": new URL("./packages/policy/src/index.ts", import.meta.url).pathname,
      // Mirrors web/tsconfig.json's "@/*" -> "./*" path mapping, so web/lib
      // files that import via "@/..." can be unit-tested directly.
      "@/": new URL("./web/", import.meta.url).pathname,
    },
  },
});
