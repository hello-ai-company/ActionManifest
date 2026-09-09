import { createRequire } from "node:module";
import type { ErrorObject, ValidateFunction } from "ajv";
import {
  actionManifestSchemasByVersion,
  canonicalDocumentSchema,
  SUPPORTED_SCHEMA_VERSIONS,
  type ActionManifest,
  type CanonicalDocument,
} from "@actionmanifest/schema";
import { SchemaValidationError } from "./errors.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

const ajv = new Ajv({
  allErrors: true,
  strict: false,
  allowUnionTypes: true,
});
addFormats(ajv);

// One compiled validator per immutable, versioned schema. schema_version selects
// exactly one — a 0.1.0 manifest is validated against the frozen v0.1 schema and
// therefore cannot carry v0.2-only fields.
const manifestValidatorsByVersion: Record<string, ValidateFunction> = Object.fromEntries(
  Object.entries(actionManifestSchemasByVersion).map(([version, schema]) => [
    version,
    ajv.compile(schema),
  ]),
);
const validateDocumentFn = ajv.compile(canonicalDocumentSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
    .join("; ");
}

export function validateActionManifest(data: unknown): ActionManifest {
  // Fail closed: never trust or cast on schema_version before dispatching.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new SchemaValidationError("Action Manifest must be a JSON object");
  }
  const version = (data as Record<string, unknown>).schema_version;
  if (typeof version !== "string") {
    throw new SchemaValidationError(
      "Action Manifest is missing a string schema_version",
    );
  }
  const validate = manifestValidatorsByVersion[version];
  if (!validate) {
    throw new SchemaValidationError(
      `Unsupported schema_version ${version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
    );
  }
  if (!validate(data)) {
    throw new SchemaValidationError(
      `Action Manifest failed schema ${version} validation: ${formatErrors(validate.errors)}`,
      validate.errors,
    );
  }
  const manifest = data as ActionManifest;
  for (const action of manifest.actions) {
    if (!action.evidence || action.evidence.length === 0) {
      throw new SchemaValidationError(
        `Action ${action.id} has no evidence (constitution: source before inference)`,
      );
    }
  }
  return manifest;
}

export function validateCanonicalDocument(data: unknown): CanonicalDocument {
  if (!validateDocumentFn(data)) {
    throw new SchemaValidationError(
      `CanonicalDocument failed schema validation: ${formatErrors(validateDocumentFn.errors)}`,
    );
  }
  return data as CanonicalDocument;
}

export function tryValidateActionManifest(
  data: unknown,
): { ok: true; value: ActionManifest } | { ok: false; error: SchemaValidationError } {
  try {
    return { ok: true, value: validateActionManifest(data) };
  } catch (e) {
    if (e instanceof SchemaValidationError) return { ok: false, error: e };
    throw e;
  }
}
