import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020");
const addFormats = require("ajv-formats");

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const schemasDir = join(root, "packages/schema/schemas");
const manifestSchemaV01 = JSON.parse(
  readFileSync(join(schemasDir, "v0.1/action-manifest.schema.json"), "utf8"),
);
const manifestSchemaV02 = JSON.parse(
  readFileSync(join(schemasDir, "v0.2/action-manifest.schema.json"), "utf8"),
);
const documentSchema = JSON.parse(
  readFileSync(join(schemasDir, "canonical-document.schema.json"), "utf8"),
);

const validateV01 = ajv.compile(manifestSchemaV01);
const validateV02 = ajv.compile(manifestSchemaV02);
const validateDocument = ajv.compile(documentSchema);

const action = {
  id: "act_001",
  kind: "event",
  title: "sample",
  modality: "unknown",
  actor: { certainty: "unknown" },
  evidence: [{ source_id: "sample", text: "hello" }],
  inference: "explicit",
  status: "proposed",
};

const sampleV01 = { schema_version: "0.1.0", source: { id: "sample" }, actions: [action] };
const sampleV02 = {
  schema_version: "0.2.0",
  source: { id: "sample" },
  actions: [action],
  receipt: {
    extraction: {
      provider: "deterministic",
      model: "notice-rules-v0.1",
      extractor_version: "0.1.0",
      schema_version: "0.2.0",
      created_at: "2026-09-09T00:00:00.000Z",
    },
    verification: {
      evidence_supported: true,
      temporal_supported: true,
      actor_supported: true,
      modality_supported: true,
      source_hash_matched: true,
      negation_conflict: false,
      page_refs_valid: true,
      passed: true,
      total_actions: 1,
      verified_actions: 1,
      failed_actions: 0,
      warning_actions: 0,
      actions: [
        {
          action_id: "act_001",
          passed: true,
          evidence_supported: true,
          temporal_supported: true,
          actor_supported: true,
          modality_supported: true,
          negation_conflict: false,
          page_refs_valid: true,
          issues: [],
        },
      ],
    },
  },
};

const sampleDoc = { id: "sample", text: "hello", pages: [{ pageNumber: 1, text: "hello" }] };

function assert(ok: boolean, label: string, errors?: unknown): void {
  if (!ok) {
    console.error(`schema: FAIL (${label})`);
    if (errors) console.error(errors);
    process.exit(1);
  }
}

// Positive cases
assert(validateV01(sampleV01), "v0.1 sample", validateV01.errors);
assert(validateV02(sampleV02), "v0.2 sample", validateV02.errors);
assert(validateDocument(sampleDoc), "canonical document", validateDocument.errors);

// Immutability guard: v0.1 schema must REJECT v0.2-only fields.
const v01WithV02Fields = {
  schema_version: "0.1.0",
  source: { id: "sample" },
  actions: [action],
  receipt: {
    extraction: sampleV02.receipt.extraction,
    verification: {
      evidence_supported: true,
      temporal_supported: true,
      actor_supported: true,
      modality_supported: true,
      source_hash_matched: true,
      negation_conflict: false,
      page_refs_valid: true,
      passed: true,
      actions: [],
    },
  },
};
assert(!validateV01(v01WithV02Fields), "v0.1 must reject v0.2-only verification fields");

// Identity guard: $id and const must match the version.
assert(String(manifestSchemaV01.$id).includes("/v0.1/"), "v0.1 $id contains /v0.1/");
assert(String(manifestSchemaV02.$id).includes("/v0.2/"), "v0.2 $id contains /v0.2/");
assert(manifestSchemaV01.properties.schema_version.const === "0.1.0", "v0.1 const 0.1.0");
assert(manifestSchemaV02.properties.schema_version.const === "0.2.0", "v0.2 const 0.2.0");

console.log("schema: PASS (v0.1 + v0.2 action-manifest + canonical-document, immutability + identity checks)");
