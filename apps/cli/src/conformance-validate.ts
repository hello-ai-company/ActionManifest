import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { SuiteManifest } from "./conformance.js";

const require = createRequire(import.meta.url);
const Ajv = require("ajv/dist/2020") as typeof import("ajv").default;
const addFormats = require("ajv-formats") as (ajv: InstanceType<typeof Ajv>) => void;

/**
 * Conformance suite self-validation (Phase 2.1 final hardening).
 *
 * Normative test data is code: every vector and the suite manifest are
 * validated against the Draft 2020-12 meta-schemas under conformance/schema/
 * BEFORE execution. A malformed vector (typo'd expectation field, unknown
 * profile, missing required key) is a runner/config error — never a silent
 * pass and never a conformance failure.
 *
 * The meta-schemas are part of the language-neutral contract: third-party
 * implementations can validate vectors without any TypeScript types.
 */
export class ConformanceConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConformanceConfigError";
  }
}

const here = dirname(fileURLToPath(import.meta.url));

function conformanceSchemaDir(): string {
  const candidates = [
    join(process.cwd(), "conformance", "schema"),
    join(here, "../../../conformance/schema"),
    join(here, "../../../../conformance/schema"),
  ];
  for (const c of candidates) {
    try {
      readFileSync(join(c, "suite-manifest.schema.json"), "utf8");
      return c;
    } catch {
      /* try next */
    }
  }
  throw new ConformanceConfigError("conformance/schema directory not found");
}

function loadJson(path: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch (e) {
    throw new ConformanceConfigError(
      `cannot read/parse ${path}: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

const ajv = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
addFormats(ajv);

const KNOWN_PROFILES = [
  "schema",
  "canonical-document",
  "evidence",
  "trust",
  "temporal",
  "ics",
  "reference-serialization",
] as const;
type KnownProfile = (typeof KNOWN_PROFILES)[number];

let validators: Map<KnownProfile, import("ajv").ValidateFunction> | undefined;
let manifestValidator: import("ajv").ValidateFunction | undefined;

function getManifestValidator(): import("ajv").ValidateFunction {
  if (!manifestValidator) {
    manifestValidator = ajv.compile(
      loadJson(join(conformanceSchemaDir(), "suite-manifest.schema.json")),
    );
  }
  return manifestValidator;
}

function getVectorValidator(profile: KnownProfile): import("ajv").ValidateFunction {
  if (!validators) {
    validators = new Map(
      KNOWN_PROFILES.map((p) => [
        p,
        ajv.compile(loadJson(join(conformanceSchemaDir(), "profiles", `${p}.schema.json`))),
      ]),
    );
  }
  return validators.get(profile)!;
}

function formatAjvErrors(errors: unknown): string {
  return (Array.isArray(errors) ? errors : [])
    .map((e) => {
      const err = e as { instancePath?: string; message?: string };
      return `${err.instancePath || "/"} ${err.message ?? "invalid"}`;
    })
    .join("; ");
}

/** Validate the suite manifest (structure + subset/uniqueness invariants). */
export function validateSuiteManifest(data: unknown): SuiteManifest {
  const validate = getManifestValidator();
  if (!validate(data)) {
    throw new ConformanceConfigError(
      `suite manifest failed validation: ${formatAjvErrors(validate.errors)}`,
    );
  }
  const manifest = data as SuiteManifest;
  const profileSet = new Set(manifest.profiles);
  for (const smoke of manifest.smoke_profiles) {
    if (!profileSet.has(smoke)) {
      throw new ConformanceConfigError(
        `smoke_profiles entry "${smoke}" is not a declared universal profile`,
      );
    }
  }
  for (const ref of manifest.reference_profiles) {
    if (profileSet.has(ref)) {
      throw new ConformanceConfigError(
        `reference profile "${ref}" must not also be a universal profile`,
      );
    }
  }
  return manifest;
}

/**
 * Validate one vector against its profile schema. `profileFromDir` is the
 * vectors/ subdirectory it was loaded from; a mismatch is a config error.
 */
export function validateVector(data: unknown, profileFromDir: string): void {
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    throw new ConformanceConfigError("vector must be a JSON object");
  }
  const profile = (data as { profile?: unknown }).profile;
  if (typeof profile !== "string" || !(KNOWN_PROFILES as readonly string[]).includes(profile)) {
    throw new ConformanceConfigError(
      `unknown vector profile: ${JSON.stringify(profile)} (known: ${KNOWN_PROFILES.join(", ")})`,
    );
  }
  if (profile !== profileFromDir) {
    throw new ConformanceConfigError(
      `vector profile "${profile}" does not match its directory "${profileFromDir}"`,
    );
  }
  const validate = getVectorValidator(profile as KnownProfile);
  if (!validate(data)) {
    throw new ConformanceConfigError(
      `vector ${(data as { id?: unknown }).id ?? "?"} failed ${profile} schema validation: ${formatAjvErrors(validate.errors)}`,
    );
  }
}
