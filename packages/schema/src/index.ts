export {
  SCHEMA_VERSION,
  SUPPORTED_SCHEMA_VERSIONS,
  ACTION_KINDS,
  MODALITIES,
  TEMPORAL_TYPES,
  REVIEW_STATUSES,
} from "./types.js";
export type * from "./types.js";

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Versioned schemas are immutable and live under `<pkg>/schemas/`. `here` is
 * either `<pkg>/dist` (built) or `<pkg>/src` (tsx), so the package root is one
 * level up in both cases.
 */
function loadSchema(relFromSchemas: string): Record<string, unknown> {
  const candidates = [
    join(here, "..", "schemas", relFromSchemas),
    join(here, "schemas", relFromSchemas),
  ];
  for (const path of candidates) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    } catch {
      /* try next candidate */
    }
  }
  throw new Error(`Schema not found: ${relFromSchemas}`);
}

/** Frozen Phase 1 contract (schema_version 0.1.0). Never add v0.2 fields here. */
export const actionManifestSchemaV01 = loadSchema("v0.1/action-manifest.schema.json");
/** Phase 1.1 contract (schema_version 0.2.0) with per-action verification. */
export const actionManifestSchemaV02 = loadSchema("v0.2/action-manifest.schema.json");
export const canonicalDocumentSchema = loadSchema("canonical-document.schema.json");

/** Map schema_version → its exact, immutable JSON Schema. */
export const actionManifestSchemasByVersion: Record<string, Record<string, unknown>> = {
  "0.1.0": actionManifestSchemaV01,
  "0.2.0": actionManifestSchemaV02,
};

/** Back-compat: the latest manifest schema. Prefer actionManifestSchemasByVersion. */
export const actionManifestSchema = actionManifestSchemaV02;
