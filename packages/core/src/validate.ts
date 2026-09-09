import { createRequire } from "node:module";
import type { ErrorObject } from "ajv";
import {
  actionManifestSchema,
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

const validateManifestFn = ajv.compile(actionManifestSchema);
const validateDocumentFn = ajv.compile(canonicalDocumentSchema);

function formatErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((e) => `${e.instancePath || "/"} ${e.message ?? "invalid"}`)
    .join("; ");
}

export function validateActionManifest(data: unknown): ActionManifest {
  if (!validateManifestFn(data)) {
    throw new SchemaValidationError(
      `Action Manifest failed schema validation: ${formatErrors(validateManifestFn.errors)}`,
      validateManifestFn.errors,
    );
  }
  const manifest = data as ActionManifest;
  if (!(SUPPORTED_SCHEMA_VERSIONS as readonly string[]).includes(manifest.schema_version)) {
    throw new SchemaValidationError(
      `Unsupported schema_version ${manifest.schema_version}; expected one of ${SUPPORTED_SCHEMA_VERSIONS.join(", ")}`,
    );
  }
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
      validateDocumentFn.errors,
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
