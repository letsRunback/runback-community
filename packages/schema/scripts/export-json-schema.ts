/**
 * Exports the runtime zod validator (the actual source of truth for what
 * /api/ingest accepts) as a JSON Schema, checked into packages/schema/schema.json.
 *
 * Why this exists: the Python SDK (packages/sdk-python) can't import a TS
 * module, so its test suite validates real constructed payloads against
 * this file instead — a TS schema change that isn't mirrored in the Python
 * port fails Python's own test suite (see
 * packages/sdk-python/tests/test_schema_conformance.py), rather than
 * silently drifting apart.
 *
 * Run: npx tsx packages/schema/scripts/export-json-schema.ts
 * Re-run and re-commit schema.json whenever validate.ts changes.
 */
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ingestPayloadSchema } from "../src/validate";

const __dirname = dirname(fileURLToPath(import.meta.url));

const jsonSchema = zodToJsonSchema(ingestPayloadSchema, {
  name: "IngestPayload",
  $refStrategy: "none", // inline everything — simplest to consume from Python's jsonschema library
});

const outPath = join(__dirname, "..", "schema.json");
writeFileSync(outPath, JSON.stringify(jsonSchema, null, 2) + "\n");
console.log(`Wrote ${outPath}`);
