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

/**
 * Locate the meta-schema directory. When the runner was given an explicit
 * suite root (`--root`), the meta-schemas MUST come from that same suite —
 * validating one suite's vectors against another suite's schemas is a config
 * error. Without an explicit root, prefer the suite bundled inside the
 * installed @actionmanifest/cli package, then repo-checkout locations.
 */
function conformanceSchemaDir(suiteRoot?: string): string {
  if (suiteRoot) {
    const dir = join(suiteRoot, "schema");
    try {
      readFileSync(join(dir, "suite-manifest.schema.json"), "utf8");
      return dir;
    } catch {
      throw new ConformanceConfigError(
        `suite root ${suiteRoot} has no readable schema/suite-manifest.schema.json`,
      );
    }
  }
  const candidates = [
    join(here, "../conformance/schema"),
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

// One Ajv instance per meta-schema directory: compiling the same $id twice on
// a single instance throws, and distinct suite roots must never share state.
const ajvByDir = new Map<string, InstanceType<typeof Ajv>>();
function ajvForDir(dir: string): InstanceType<typeof Ajv> {
  let instance = ajvByDir.get(dir);
  if (!instance) {
    instance = new Ajv({ allErrors: true, strict: false, allowUnionTypes: true });
    addFormats(instance);
    ajvByDir.set(dir, instance);
  }
  return instance;
}

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

// Validators are cached per meta-schema directory so an explicit --root
// suite and the default suite never share compiled schemas.
const manifestValidators = new Map<string, import("ajv").ValidateFunction>();
const vectorValidators = new Map<string, Map<KnownProfile, import("ajv").ValidateFunction>>();

function getManifestValidator(suiteRoot?: string): import("ajv").ValidateFunction {
  const dir = conformanceSchemaDir(suiteRoot);
  let validator = manifestValidators.get(dir);
  if (!validator) {
    validator = ajvForDir(dir).compile(loadJson(join(dir, "suite-manifest.schema.json")));
    manifestValidators.set(dir, validator);
  }
  return validator;
}

function getVectorValidator(
  profile: KnownProfile,
  suiteRoot?: string,
): import("ajv").ValidateFunction {
  const dir = conformanceSchemaDir(suiteRoot);
  let validators = vectorValidators.get(dir);
  if (!validators) {
    const ajv = ajvForDir(dir);
    validators = new Map(
      KNOWN_PROFILES.map((p) => [
        p,
        ajv.compile(loadJson(join(dir, "profiles", `${p}.schema.json`))),
      ]),
    );
    vectorValidators.set(dir, validators);
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
export function validateSuiteManifest(data: unknown, suiteRoot?: string): SuiteManifest {
  const validate = getManifestValidator(suiteRoot);
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
export function validateVector(data: unknown, profileFromDir: string, suiteRoot?: string): void {
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
  const validate = getVectorValidator(profile as KnownProfile, suiteRoot);
  if (!validate(data)) {
    throw new ConformanceConfigError(
      `vector ${(data as { id?: unknown }).id ?? "?"} failed ${profile} schema validation: ${formatAjvErrors(validate.errors)}`,
    );
  }
}
