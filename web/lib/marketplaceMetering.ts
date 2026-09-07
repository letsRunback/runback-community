/**
 * GROUNDWORK, NOT A COMPLETED INTEGRATION.
 *
 * A pluggable hook for reporting usage to a cloud marketplace's metering
 * service (AWS Marketplace Metering Service, Azure Marketplace metered
 * billing, etc.) — the mechanism a marketplace listing uses to bill a
 * customer who bought Runback through AWS/Azure rather than directly.
 *
 * Listing on a marketplace is a business action (registering a product,
 * getting it reviewed, negotiating terms) that has to happen outside this
 * codebase before any of this can activate. What lives here is only the
 * technical prerequisite: a stable call site (reportUsage) wired into the
 * one place usage is already metered (meterIngest, in lib/usage.ts), plus a
 * provider interface so a real marketplace client can be dropped in without
 * touching the call site again.
 *
 * Until AWS_MARKETPLACE_PRODUCT_CODE (or an Azure equivalent) is set, the
 * no-op provider is active and this module does nothing.
 */

export interface MeteringProvider {
  readonly name: string;
  reportUsage(orgId: string, metric: string, quantity: number): Promise<void>;
}

/** Default provider — no marketplace configured. Every call is a silent no-op. */
class NoopMeteringProvider implements MeteringProvider {
  readonly name = "noop";
  async reportUsage(): Promise<void> {
    // intentionally empty
  }
}

/**
 * Structurally correct AWS Marketplace Metering Service client — but NOT a
 * verified integration. It has never been run against a real registered
 * marketplace product, because none exists yet. Treat the request shape as
 * "written against the documented API," not "proven correct in production."
 * Before relying on this, register the product in AWS Marketplace Management
 * Portal, obtain a product code, and test against a real (sandboxed) buyer.
 *
 * Docs: https://docs.aws.amazon.com/marketplacemetering/latest/APIReference/API_MeterUsage.html
 */
class AwsMarketplaceMeteringProvider implements MeteringProvider {
  readonly name = "aws-marketplace";
  private readonly productCode: string;
  private readonly region: string;

  constructor(productCode: string, region: string) {
    this.productCode = productCode;
    this.region = region;
  }

  async reportUsage(orgId: string, metric: string, quantity: number): Promise<void> {
    // AWS SigV4-signed request to the MeterUsage API. Left unimplemented
    // deliberately: signing needs the org's AWS marketplace customer id
    // (captured at marketplace-subscribe time, which doesn't exist yet — no
    // subscribe webhook is wired up) and credentials scoped to this product,
    // neither of which can be tested without a live listing. Wiring this up
    // for real is the next step once the product is registered, not before.
    console.warn(
      `[marketplaceMetering] aws-marketplace provider is a stub — dropping usage report ` +
      `(org=${orgId}, metric=${metric}, quantity=${quantity}, product=${this.productCode}, region=${this.region})`
    );
  }
}

let provider: MeteringProvider | null = null;

function getProvider(): MeteringProvider {
  if (provider) return provider;
  const productCode = process.env.AWS_MARKETPLACE_PRODUCT_CODE;
  provider = productCode
    ? new AwsMarketplaceMeteringProvider(productCode, process.env.AWS_MARKETPLACE_REGION || "us-east-1")
    : new NoopMeteringProvider();
  return provider;
}

export function marketplaceMeteringEnabled(): boolean {
  return !!process.env.AWS_MARKETPLACE_PRODUCT_CODE;
}

/**
 * Report a usage event for an org. Fire-and-forget by design — a marketplace
 * metering failure must never block or slow down ingest, which is why callers
 * don't await this inline on the request's critical path. Errors are logged,
 * not thrown.
 */
export async function reportUsage(orgId: string, metric: string, quantity: number): Promise<void> {
  if (quantity <= 0) return;
  try {
    await getProvider().reportUsage(orgId, metric, quantity);
  } catch (e) {
    console.error(`[marketplaceMetering] reportUsage failed (org=${orgId}, metric=${metric}):`, e);
  }
}

/** Test-only: reset the cached provider so env var changes take effect. */
export function __resetForTests(): void {
  provider = null;
}
