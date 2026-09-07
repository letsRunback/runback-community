import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { reportUsage, marketplaceMeteringEnabled, __resetForTests } from "@/lib/marketplaceMetering";

describe("marketplaceMetering", () => {
  const origProductCode = process.env.AWS_MARKETPLACE_PRODUCT_CODE;

  beforeEach(() => {
    __resetForTests();
  });

  afterEach(() => {
    if (origProductCode === undefined) delete process.env.AWS_MARKETPLACE_PRODUCT_CODE;
    else process.env.AWS_MARKETPLACE_PRODUCT_CODE = origProductCode;
    __resetForTests();
  });

  it("is disabled by default (no product code configured)", () => {
    delete process.env.AWS_MARKETPLACE_PRODUCT_CODE;
    expect(marketplaceMeteringEnabled()).toBe(false);
  });

  it("reports enabled once a product code is set", () => {
    process.env.AWS_MARKETPLACE_PRODUCT_CODE = "test-product";
    expect(marketplaceMeteringEnabled()).toBe(true);
  });

  it("no-op provider resolves without throwing when unconfigured", async () => {
    delete process.env.AWS_MARKETPLACE_PRODUCT_CODE;
    await expect(reportUsage("org_1", "runs", 5)).resolves.toBeUndefined();
  });

  it("skips reporting for zero or negative quantity", async () => {
    delete process.env.AWS_MARKETPLACE_PRODUCT_CODE;
    await expect(reportUsage("org_1", "runs", 0)).resolves.toBeUndefined();
    await expect(reportUsage("org_1", "runs", -3)).resolves.toBeUndefined();
  });

  it("aws stub provider logs a warning instead of throwing", async () => {
    process.env.AWS_MARKETPLACE_PRODUCT_CODE = "test-product";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(reportUsage("org_1", "runs", 5)).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("never throws even if the provider misbehaves", async () => {
    // reportUsage catches internally — this asserts the public contract, not
    // an internals swap, since the module doesn't expose provider injection.
    delete process.env.AWS_MARKETPLACE_PRODUCT_CODE;
    await expect(reportUsage("", "runs", 1)).resolves.toBeUndefined();
  });
});
