/**
 * Explicit, auditable escape hatch for package-security MANUAL_REQUIRED /
 * UNSUPPORTED. Never a silent PASS. Never tokens or one-time codes.
 *
 * Status stays MANUAL_REQUIRED / UNSUPPORTED (not OK). A valid attestation
 * only unblocks READY when `--attest-manual-security` is passed and the
 * record covers every such package. Loading the file without the flag is
 * a no-op.
 */
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  assertNoSecrets,
  type SecurityAttestationApplication,
} from "./release-setup-plan.js";

export const MANUAL_SECURITY_ATTESTATION_KIND =
  "actionmanifest-manual-package-security-attestation" as const;

/** Human-committed break-glass evidence (not created by this controller). */
export const DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE =
  "docs/evidence/manual-package-security-attestation.json";

/** Committed template — placeholders fail validation on purpose. */
export const EXAMPLE_MANUAL_SECURITY_ATTESTATION_RELATIVE =
  "docs/evidence/manual-package-security-attestation.example.json";

/** Optional local file — gitignored; never tokens or one-time codes. */
export const LOCAL_MANUAL_SECURITY_ATTESTATION_RELATIVE =
  "release-manual-security-attestation.json";

const ALLOWED_KEYS = new Set([
  "kind",
  "attestedBy",
  "attestedAt",
  "packages",
  "verifiedInNpmUi",
  "notes",
]);

const PLACEHOLDER_ATTESTED_BY = [
  "_example_do_not_use",
  "example",
  "your_name",
  "your-name",
  "replace",
  "replace_me",
  "todo",
  "changeme",
  "tbd",
  "n/a",
  "na",
];

const SECRET_KEY = /token|otp|password|authorization|cookie|secret|npm_token|node_auth/i;

const ISO_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export interface ManualSecurityAttestation {
  kind: typeof MANUAL_SECURITY_ATTESTATION_KIND;
  attestedBy: string;
  attestedAt: string;
  packages: string[];
  verifiedInNpmUi: string;
  notes?: string;
}

export interface AttestationLoadResult {
  requested: boolean;
  loaded: boolean;
  applied: boolean;
  path: string | null;
  record: ManualSecurityAttestation | null;
  error: string | null;
}

export function idleAttestation(): SecurityAttestationApplication {
  return { requested: false, applied: false, coveredPackages: [] };
}

export function toAttestationApplication(
  loaded: AttestationLoadResult,
): SecurityAttestationApplication {
  return {
    requested: loaded.requested,
    applied: loaded.applied,
    coveredPackages: loaded.applied && loaded.record ? [...loaded.record.packages] : [],
    error: loaded.error ?? undefined,
    attestedBy: loaded.record?.attestedBy,
    attestedAt: loaded.record?.attestedAt,
    path: loaded.path ?? undefined,
  };
}

export function resolveAttestationPath(repoRoot: string, relativeOrAbsolute: string): string {
  return isAbsolute(relativeOrAbsolute) ? relativeOrAbsolute : join(repoRoot, relativeOrAbsolute);
}

export function loadManualSecurityAttestation(opts: {
  requested: boolean;
  path: string | null;
}): AttestationLoadResult {
  if (!opts.requested) {
    return {
      requested: false,
      loaded: false,
      applied: false,
      path: opts.path,
      record: null,
      error: null,
    };
  }
  if (!opts.path) {
    return {
      requested: true,
      loaded: false,
      applied: false,
      path: null,
      record: null,
      error: "attestation path missing — refuse silent PASS",
    };
  }
  if (!existsSync(opts.path)) {
    return {
      requested: true,
      loaded: false,
      applied: false,
      path: opts.path,
      record: null,
      error: `attestation file missing: ${opts.path} — READY stays blocked`,
    };
  }
  let raw: string;
  try {
    raw = readFileSync(opts.path, "utf8");
  } catch (error) {
    return {
      requested: true,
      loaded: false,
      applied: false,
      path: opts.path,
      record: null,
      error: `attestation unreadable: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
  if (!raw.trim()) {
    return {
      requested: true,
      loaded: true,
      applied: false,
      path: opts.path,
      record: null,
      error: "attestation file is empty — never fake OK from empty reads",
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      requested: true,
      loaded: true,
      applied: false,
      path: opts.path,
      record: null,
      error: "attestation is not JSON — never fake OK",
    };
  }
  const validated = validateManualSecurityAttestation(parsed);
  if (!validated.ok) {
    return {
      requested: true,
      loaded: true,
      applied: false,
      path: opts.path,
      record: null,
      error: validated.error,
    };
  }
  return {
    requested: true,
    loaded: true,
    applied: true,
    path: opts.path,
    record: validated.record,
    error: null,
  };
}

export function validateManualSecurityAttestation(
  raw: unknown,
): { ok: true; record: ManualSecurityAttestation } | { ok: false; error: string } {
  try {
    assertNoSecrets(JSON.stringify(raw), "manual security attestation");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "attestation contains forbidden secret-shaped text",
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "attestation must be a JSON object" };
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      return { ok: false, error: `attestation has unsupported key ${key}` };
    }
    if (SECRET_KEY.test(key)) {
      return { ok: false, error: `attestation forbids secret-shaped key ${key}` };
    }
  }
  if (obj.kind !== MANUAL_SECURITY_ATTESTATION_KIND) {
    return {
      ok: false,
      error: `attestation kind must be ${MANUAL_SECURITY_ATTESTATION_KIND}`,
    };
  }
  const attestedBy = typeof obj.attestedBy === "string" ? obj.attestedBy.trim() : "";
  if (attestedBy.length < 2) {
    return { ok: false, error: "attestedBy must be a non-empty maintainer identity" };
  }
  if (PLACEHOLDER_ATTESTED_BY.includes(attestedBy.toLowerCase())) {
    return { ok: false, error: "attestedBy is a placeholder — example records cannot unblock READY" };
  }
  const attestedAt = typeof obj.attestedAt === "string" ? obj.attestedAt.trim() : "";
  if (!ISO_AT.test(attestedAt) || !Number.isFinite(Date.parse(attestedAt))) {
    return { ok: false, error: "attestedAt must be an ISO-8601 timestamp" };
  }
  if (!Array.isArray(obj.packages) || obj.packages.length === 0) {
    return { ok: false, error: "packages must be a non-empty array of public package names" };
  }
  const packages: string[] = [];
  for (const name of obj.packages) {
    if (typeof name !== "string" || !name.trim()) {
      return { ok: false, error: "packages must be non-empty strings" };
    }
    if (!(PUBLIC_PACKAGE_NAMES as readonly string[]).includes(name)) {
      return { ok: false, error: `attestation names unknown package ${name}` };
    }
    if (!packages.includes(name)) packages.push(name);
  }
  const verifiedInNpmUi = typeof obj.verifiedInNpmUi === "string" ? obj.verifiedInNpmUi.trim() : "";
  if (!verifiedInNpmUi) {
    return { ok: false, error: "verifiedInNpmUi must describe what was checked in the npm Settings UI" };
  }
  const ui = verifiedInNpmUi.toLowerCase();
  const has2fa = /\b(two-factor|two factor|2fa)\b/.test(ui);
  const hasDisallow = /disallow\s+tokens?/.test(ui);
  const hasUi = /\bnpm(js)?\b|settings|publishing access/.test(ui);
  if (!has2fa || !hasDisallow || !hasUi) {
    return {
      ok: false,
      error:
        "verifiedInNpmUi must name the npm Settings control (two-factor / 2FA and disallow tokens)",
    };
  }
  if (obj.notes !== undefined && typeof obj.notes !== "string") {
    return { ok: false, error: "notes must be a string when present" };
  }
  const record: ManualSecurityAttestation = {
    kind: MANUAL_SECURITY_ATTESTATION_KIND,
    attestedBy,
    attestedAt,
    packages,
    verifiedInNpmUi,
    ...(obj.notes !== undefined ? { notes: obj.notes } : {}),
  };
  try {
    assertNoSecrets(JSON.stringify(record), "manual security attestation record");
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "attestation record failed secret scan",
    };
  }
  return { ok: true, record };
}
