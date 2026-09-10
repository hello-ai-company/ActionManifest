/**
 * sbom-validate — offline validation of the generated SBOM against the
 * OFFICIAL CycloneDX 1.5 JSON Schema (vendored under scripts/vendor/, incl.
 * its spdx.schema.json and jsf-0.82.schema.json sub-schemas — no remote
 * fetches at validation time).
 *
 * The official schema is strict (root additionalProperties: false, enum'd
 * bomFormat/specVersion, required fields per component). A generated
 * sbom.cdx.json that fails validation fails the release dry-run.
 *
 * Format note: the schema also uses the `iri-reference` and `idn-email`
 * formats, which ajv-formats@3 does not implement. Our SBOM contains no such
 * fields; the formats are registered as non-enforcing so compilation is
 * clean. All structural constraints (types, required, enums,
 * additionalProperties, pattern, minItems, …) are fully enforced.
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(join(here, "..", "package.json"));
const Ajv = require("ajv") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

const VENDOR_DIR = join(here, "vendor");
const BOM_SCHEMA = join(VENDOR_DIR, "cyclonedx-1.5.schema.json");
const SUB_SCHEMAS = ["spdx.schema.json", "jsf-0.82.schema.json"] as const;

export interface SbomValidationResult {
  valid: boolean;
  errors: string[];
}

let cached: import("ajv").ValidateFunction | undefined;

/** Compile the vendored official schema once (offline). */
export function getSbomValidator(): import("ajv").ValidateFunction {
  if (cached) return cached;
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);
  // Not implemented by ajv-formats@3; unused by our SBOM. Registered as
  // non-enforcing so compilation stays warning-free.
  ajv.addFormat("iri-reference", true);
  ajv.addFormat("idn-email", true);
  for (const sub of SUB_SCHEMAS) {
    ajv.addSchema(JSON.parse(readFileSync(join(VENDOR_DIR, sub), "utf8")) as object);
  }
  cached = ajv.compile(JSON.parse(readFileSync(BOM_SCHEMA, "utf8")) as object) as import("ajv").ValidateFunction;
  return cached;
}

/** Validate a parsed SBOM document against the official CycloneDX 1.5 schema. */
export function validateSbom(data: unknown): SbomValidationResult {
  const validate = getSbomValidator();
  const valid = validate(data) as boolean;
  const errors = (validate.errors ?? []).map(
    (e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`,
  );
  return { valid, errors };
}
