/**
 * Policy-as-code — the engine now lives in the shared @runback/policy package so
 * the SAME code runs in the release gate, policy simulation, AND in-process
 * runtime enforcement (the SDK pre-hook). This file re-exports it so existing
 * web imports keep working unchanged.
 */
export * from "@runback/policy";
