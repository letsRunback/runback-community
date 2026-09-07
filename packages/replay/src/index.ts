/**
 * Community entry point — everything here is free to self-host.
 *
 * The commercially-licensed "Deep replay H2/H3" surface is deliberately NOT
 * re-exported from this file: it lives behind `@runback/replay/enterprise`
 * (src/enterprise/index.ts). That separation is what lets a Community build
 * delete src/enterprise/ and still resolve this module — verified by
 * scripts/verify-community-build.sh rather than asserted in a comment.
 */
export * from "./cassette";
export * from "./harness";
export * from "./digest";
export * from "./gate";
export * from "./divergenceScore";
// Small, pure, self-contained algorithms with no engine dependency — bisect is
// textbook binary search, determinism is a report over already-captured events.
// Both are already public (runback-proofs, and a published blog post), and the
// marketing site runs bisect live as its own proof. Community.
export * from "./bisect";
export * from "./determinism";
