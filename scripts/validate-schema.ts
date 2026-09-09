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

const manifestSchema = JSON.parse(
  readFileSync(join(root, "packages/schema/src/action-manifest.schema.json"), "utf8"),
);
const documentSchema = JSON.parse(
  readFileSync(join(root, "packages/schema/src/canonical-document.schema.json"), "utf8"),
);

const validateManifest = ajv.compile(manifestSchema);
const validateDocument = ajv.compile(documentSchema);

const sampleManifest = {
  schema_version: "0.1.0",
  source: { id: "sample" },
  actions: [
    {
      id: "act_001",
      kind: "event",
      title: "sample",
      modality: "unknown",
      actor: { certainty: "unknown" },
      evidence: [{ source_id: "sample", text: "hello" }],
      inference: "explicit",
      status: "proposed",
    },
  ],
};

const sampleDoc = { id: "sample", text: "hello", pages: [{ pageNumber: 1, text: "hello" }] };

if (!validateManifest(sampleManifest)) {
  console.error(validateManifest.errors);
  process.exit(1);
}
if (!validateDocument(sampleDoc)) {
  console.error(validateDocument.errors);
  process.exit(1);
}

console.log("schema: PASS (action-manifest + canonical-document)");
