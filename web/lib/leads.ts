/**
 * Lead capture for the Community edition get-started gate.
 *
 * The source is public for transparency, but the supported path to deploy is
 * gated on a WORK email — so we know who is running it. Personal-email providers
 * are rejected; the captured domain is the signal a sales/partnerships motion
 * runs on.
 */
import { getAdminClient } from "@/lib/supabase/admin";
import { sendLeadWelcome, sendLeadNotification } from "@/lib/email";
import { issueApiKey } from "@/lib/apiKeys";
import { ensureUserAndOrg } from "@/lib/auth";

/** Common free/personal email providers — not "official" work addresses. */
const PERSONAL = new Set([
  "gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com",
  "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com",
  "yandex.com", "qq.com", "163.com", "126.com", "hey.com", "fastmail.com",
  "pm.me", "tutanota.com", "duck.com",
]);

export interface LeadInput {
  email: string;
  company?: string;
  useCase?: string;
  source?: string;
}

export type LeadResult =
  | { ok: true; apiKey: string | null }
  | { ok: false; error: string; code: "invalid" | "personal" | "store" };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function classifyEmail(email: string): { valid: boolean; personal: boolean; domain: string } {
  const e = email.trim().toLowerCase();
  if (!EMAIL_RE.test(e)) return { valid: false, personal: false, domain: "" };
  const domain = e.slice(e.lastIndexOf("@") + 1);
  return { valid: true, personal: PERSONAL.has(domain), domain };
}

export async function captureLead(input: LeadInput): Promise<LeadResult> {
  const email = (input.email || "").trim().toLowerCase();
  const { valid, personal, domain } = classifyEmail(email);
  if (!valid) return { ok: false, error: "Enter a valid email address.", code: "invalid" };
  if (personal) {
    return {
      ok: false,
      error: "Please use your work email — personal addresses aren't accepted for the Community edition download.",
      code: "personal",
    };
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sb = getAdminClient() as any;
    // supabase-js returns errors in `error` (it doesn't throw) — check it, or a
    // missing table would silently drop the lead.
    const { error } = await sb.from("leads").insert({
      email,
      domain,
      company: input.company?.trim() || null,
      use_case: input.useCase?.trim() || null,
      source: input.source || "get-started",
    });
    if (error) {
      console.error("[leads] store failed:", error.message || error);
      return { ok: false, error: "Couldn't save that here — finishing by email.", code: "store" };
    }
    // Provision a tenant (user + org) and a hosted free-tier ingest key scoped
    // to it, so runs they send are isolated to their workspace from the start.
    let apiKey: string | null = null;
    try {
      const { orgId } = await ensureUserAndOrg(email);
      apiKey = await issueApiKey(email, orgId);
    } catch (e) {
      console.error("[leads] tenant provisioning failed, issuing unscoped key:", e);
      apiKey = await issueApiKey(email);
    }

    // Fire both emails — signer welcome + operator alert. Never fail the capture.
    const notice = {
      email,
      domain,
      company: input.company?.trim() || null,
      useCase: input.useCase?.trim() || null,
      source: input.source || "get-started",
    };
    await Promise.allSettled([sendLeadWelcome(notice), sendLeadNotification(notice)]);
    return { ok: true, apiKey };
  } catch (e) {
    console.error("[leads] store threw:", e);
    return { ok: false, error: "Couldn't save that here — finishing by email.", code: "store" };
  }
}
