/**
 * One SSRF guard for every outbound request built from customer-supplied URLs.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A red-team pass found three separate copies of `isPrivateHost` — in sso.ts,
 * siem.ts and alerts.ts — that had already drifted apart (siem's missed
 * bracketed IPv6, so `https://[::1]/` sailed through). All three were also
 * purely lexical: they inspected the hostname STRING and never resolved it, so
 * `https://attacker.example/` with an A record of 169.254.169.254 passed every
 * check, and a public issuer could 302-redirect to an internal host because the
 * fetches followed redirects with no re-validation.
 *
 * On the multi-tenant service that is the exact hole `deployment.ts` says the
 * guard exists to close: an Enterprise admin aiming our egress at cloud
 * metadata, another tenant's internal service, or the k8s API.
 *
 * ── What this does ──────────────────────────────────────────────────────────
 *   1. one canonical private-range check, covering v4, v6, mapped v6, and the
 *      unspecified addresses (`::`, `0.0.0.0`) that route to localhost;
 *   2. DNS resolution of the target, with EVERY resolved address checked — a
 *      name that resolves to any private address is refused;
 *   3. a fetch wrapper that does NOT follow redirects blindly: each hop is
 *      re-resolved and re-checked, defeating redirect-to-internal and the
 *      save-public / resolve-internal rebinding TOCTOU.
 *
 * Self-host may opt into private targets (an internal IdP, an in-VPC collector)
 * via RUNBACK_ALLOW_PRIVATE_TARGETS, which is force-disabled on the hosted
 * service — see lib/deployment.ts.
 */
import { lookup } from "node:dns/promises";
import { allowsPrivateTargets } from "@/lib/deployment";

/** True for any IP literal that must never be a target of our egress. */
export function isPrivateIp(ip: string): boolean {
  const h = ip.toLowerCase().replace(/^\[|\]$/g, "");

  // IPv4 and IPv4-in-text
  if (/^(0\.|127\.|10\.|192\.168\.|169\.254\.)/.test(h)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true;
  if (h === "0.0.0.0" || h === "255.255.255.255") return true;

  // IPv6
  if (h === "::" || h === "::1") return true;         // unspecified, loopback
  if (/^fe[89ab]/i.test(h)) return true;               // fe80::/10 link-local
  if (/^f[cd]/i.test(h)) return true;                  // fc00::/7 unique-local
  if (/^ff/i.test(h)) return true;                     // ff00::/8 multicast

  // IPv4-mapped IPv6: ::ffff:127.0.0.1 or ::ffff:7f00:1
  if (h.startsWith("::ffff:")) {
    const m = h.slice(7);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(m)) return isPrivateIp(m);
    const groups = m.split(":");
    if (groups.length === 2) {
      const a = parseInt(groups[0], 16), b = parseInt(groups[1], 16);
      if (Number.isFinite(a) && Number.isFinite(b)) {
        return isPrivateIp(`${a >> 8}.${a & 0xff}.${b >> 8}.${b & 0xff}`);
      }
    }
    return true; // unparseable mapped form — refuse rather than guess
  }
  return false;
}

/** Lexical check on a hostname, before DNS. Catches literals and localhost. */
export function isPrivateHostname(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  // A bare IP literal is checked directly; a name falls through to DNS.
  if (/^[\d.]+$/.test(h) || h.includes(":")) return isPrivateIp(h);
  return false;
}

/**
 * Reject a URL that is not safely public.
 *
 * Async because it resolves DNS: the string can be innocent while the address
 * it names is not. Throws with a specific reason so a misconfiguration is
 * legible rather than a generic failure.
 */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new Error("Not a valid URL."); }

  if (u.protocol !== "https:") {
    throw new Error("Must use HTTPS — internal metadata and cleartext egress are refused.");
  }
  if (allowsPrivateTargets()) return u; // self-host opt-in

  if (isPrivateHostname(u.hostname)) {
    throw new Error(`Refusing a private/loopback target: ${u.hostname}`);
  }

  // The load-bearing part: resolve the NAME and refuse if ANY address is private.
  // A name with one public and one private record is still refused — the guard
  // must hold on whichever address the connection actually uses.
  let addrs: { address: string }[];
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error(`Could not resolve ${u.hostname}.`);
  }
  for (const { address } of addrs) {
    if (isPrivateIp(address)) {
      throw new Error(`${u.hostname} resolves to a private address (${address}) — refused.`);
    }
  }
  return u;
}

/**
 * fetch() that will not deliver to a private target, even across redirects.
 *
 * Redirects are handled manually: undici's default `follow` would chase a
 * 302 into an internal host with no re-check, which is the redirect-to-internal
 * bypass. Each hop is re-validated through assertPublicUrl, so rebinding between
 * hops is caught too.
 */
export async function safeFetch(
  raw: string,
  init: RequestInit = {},
  maxRedirects = 5
): Promise<Response> {
  let url = (await assertPublicUrl(raw)).toString();
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const res = await fetch(url, { ...init, redirect: "manual" });
    if (res.status < 300 || res.status >= 400) return res;
    const loc = res.headers.get("location");
    if (!loc) return res;
    // Re-validate the next hop against the same rules — a public host cannot
    // bounce us to an internal one.
    url = (await assertPublicUrl(new URL(loc, url).toString())).toString();
  }
  throw new Error("Too many redirects.");
}
