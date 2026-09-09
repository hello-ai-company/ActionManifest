export {
  SCHEMA_VERSION,
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

function loadSchema(name: string): Record<string, unknown> {
  const src = join(here, name);
  try {
    return JSON.parse(readFileSync(src, "utf8")) as Record<string, unknown>;
  } catch {
    return JSON.parse(
      readFileSync(join(here, "..", "src", name), "utf8"),
    ) as Record<string, unknown>;
  }
}

export const actionManifestSchema = loadSchema("action-manifest.schema.json");
export const canonicalDocumentSchema = loadSchema(
  "canonical-document.schema.json",
);
