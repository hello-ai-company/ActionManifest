import { DocumentAdapterError } from "@actionmanifest/core";
import { PlainTextAdapter } from "./plain-text.js";
import { DoclingAdapter } from "./docling.js";
import type { AdapterInput, DocumentAdapter } from "./types.js";

const registry: DocumentAdapter[] = [new PlainTextAdapter(), new DoclingAdapter()];

export function getAdapter(id: string): DocumentAdapter {
  const found = registry.find((a) => a.id === id);
  if (!found) throw new DocumentAdapterError(`Unknown adapter: ${id}`);
  return found;
}

export function resolveAdapter(input: AdapterInput): DocumentAdapter {
  const found = registry.find((a) => a.canHandle(input));
  if (!found) {
    throw new DocumentAdapterError(
      `No adapter for input kind=${input.kind}. Phase 1 supports plain text and Docling JSON fixtures only.`,
    );
  }
  return found;
}

export { PlainTextAdapter } from "./plain-text.js";
export { DoclingAdapter, mapDoclingFixture } from "./docling.js";
export type { AdapterInput, DocumentAdapter } from "./types.js";
