// Mint a Runback API key. Prints the raw key (store it in RUNBACK_API_KEY) and
// the SQL INSERT to run in the Supabase SQL editor / psql.
//   node scripts/make-api-key.mjs your@email.com
import crypto from "crypto";

const email = process.argv[2] || "dev@runback.local";
const raw = "rb_live_" + crypto.randomBytes(24).toString("hex");
const keyHash = crypto.createHash("sha256").update(raw).digest("hex");
const keyPrefix = raw.slice(0, 16);

console.log("\nRaw key (put in .env.local as RUNBACK_API_KEY):\n");
console.log("  " + raw + "\n");
console.log("Run this in the Supabase SQL editor / psql:\n");
console.log(
  `  INSERT INTO api_keys (key_prefix, key_hash, owner_email, plan, org_id, scope)\n` +
    `  VALUES (\n` +
    `    '${keyPrefix}',\n` +
    `    '${keyHash}',\n` +
    `    '${email}',\n` +
    `    'free',\n` +
    // A key with no org_id resolves fine (resolveApiKey in lib/ingest.ts
    // accepts a null org), but storeEvents() then hard-rejects every ingest
    // with "This API key is not attached to an organisation" — org_id is
    // NOT NULL in practice even though the column itself allows it. This
    // used to omit org_id entirely, so a self-hoster who signed in at
    // /login (which auto-creates their org via ensureUserAndOrg) and then
    // ran this script got a key that failed on its very first request,
    // with the self-hosting quickstart giving no indication why.
    //
    // Resolve it here via the same "oldest membership wins" rule
    // ensureUserAndOrg() uses, so this stays a single copy-paste step: sign
    // in once at /login first (creates the user + org), then run this
    // script and paste the INSERT — no separate org-id lookup needed.
    `    (SELECT m.org_id FROM memberships m\n` +
    `       JOIN users u ON u.id = m.user_id\n` +
    `      WHERE u.email = '${email}'\n` +
    `      ORDER BY m.created_at ASC LIMIT 1),\n` +
    `    'ingest'\n` +
    `  );\n`
);
console.log(
  "If org_id comes back NULL, sign in at http://localhost:3000/login with " +
    email + " first (creates the user + org), then re-run this INSERT.\n"
);
