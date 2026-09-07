import { defineConfig } from "tsup";

/**
 * The SDK depends on four workspace packages (@runback/schema, redact, replay,
 * policy) that are `private: true` and will never be on npm. Publishing the SDK
 * therefore means INLINING them — `noExternal` below — so a consumer installs
 * one package and needs no access to this repository.
 *
 * This is what makes the SDK a real zero-friction entry point: before it, the
 * documented install was `npm install github:letsRunback/runback#main`, which
 * fails for everyone outside the org (and would not have produced a usable
 * @runback/sdk even with access, since the repo root is a workspace root).
 *
 * `ai` stays external: it is a peer dependency, and bundling a copy would give
 * the consumer two AI SDK instances with separate module state.
 *
 * Two entries: "index" needs `ai` (withDebugger wraps a LanguageModel), "core"
 * does not, so an agent that is not built on the AI SDK can record runs without
 * installing it.
 */
export default defineConfig({
  entry: ["src/index.ts", "src/core.ts"],
  format: ["esm", "cjs"],
  // `noExternal` inlines the JS, but declarations are generated separately and
  // kept `import ... from "@runback/redact"` — bare specifiers for packages that
  // are private and 404 on npm. The runtime worked and `tsc --strict` did not:
  // every consumer got TS2307 on four modules they cannot install. Resolving
  // them inlines the types too, so the .d.ts is self-contained like the JS.
  dts: { resolve: [/^@runback\//] },
  sourcemap: true,
  clean: true,
  treeshake: true,
  target: "node20",
  // Inline every workspace package; leave real npm deps to the consumer.
  noExternal: [/^@runback\//],
  external: ["ai"],
});
