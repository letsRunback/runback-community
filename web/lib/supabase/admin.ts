import { createClient } from "@supabase/supabase-js";
import { assertNotExpired } from "@/lib/supabase/keyExpiry";

let _admin: ReturnType<typeof createClient> | null = null;

/** Service-role client for server-side writes (ingest). Never import from client code. */
export function getAdminClient() {
  if (!_admin) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error("Missing Supabase admin credentials");
    assertNotExpired("SUPABASE_SERVICE_ROLE_KEY", key);
    _admin = createClient(url, key, { auth: { persistSession: false } });
  }
  return _admin;
}
