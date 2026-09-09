/**
 * Core is local-only: types, hashing, and schema validation.
 * It MUST NOT perform network I/O or write to third-party apps
 * (Google Calendar, Gmail, Todoist, CalDAV servers, etc.).
 * File exporters live in `@actionmanifest/exporters`. Optional LLM HTTP
 * lives in `@actionmanifest/extractor` and is not Core.
 */
export { SCHEMA_VERSION, SUPPORTED_SCHEMA_VERSIONS } from "@actionmanifest/schema";
export type * from "@actionmanifest/schema";
export * from "./errors.js";
export * from "./hash.js";
export * from "./validate.js";
export * from "./canonical.js";
export * from "./receipt.js";
export * from "./manifest.js";

export const EXTRACTOR_VERSION = "0.1.0";
