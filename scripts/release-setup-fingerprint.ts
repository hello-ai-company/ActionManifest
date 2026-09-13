/**
 * Deterministic CONTROL_PLANE_CONFIG_SHA256 (no secrets, no timestamps).
 *
 * Agent Check treats READY=true as a *cached* governance assertion. The
 * cache key is this fingerprint: package set + Trusted Publisher desired
 * config + workflow identity + control-plane desired config + attestation
 * policy (hash/policy/package set only — never live npm security proof).
 */
import { createHash } from "node:crypto";
import {
  MANUAL_SECURITY_ATTESTATION_KIND,
  DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE,
} from "./release-setup-attestation.js";
import {
  READY_VARIABLE_NAME,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_RULESET_NAME,
  RELEASE_TAG_INCLUDE,
  TRUSTED_PUBLISHER_WORKFLOW,
  desiredControlPlane,
  type DesiredControlPlane,
} from "./release-setup-plan.js";

export const CONTROL_PLANE_FINGERPRINT_KIND =
  "actionmanifest-control-plane-config-fingerprint-v1" as const;

export const CONTROL_PLANE_FINGERPRINT_RELATIVE =
  "docs/evidence/control-plane-config-fingerprint.json";

export type FingerprintDriftReason =
  | "PACKAGE_SET_CHANGED"
  | "PUBLISHER_CONFIG_CHANGED"
  | "WORKFLOW_CHANGED"
  | "CONFIG_DRIFT";

export interface FingerprintWorkflowIdentity {
  filename: typeof TRUSTED_PUBLISHER_WORKFLOW;
  environment: typeof RELEASE_ENVIRONMENT_NAME;
  referencesNpmRelease: boolean;
  referencesReadyVariable: boolean;
}

export interface FingerprintAttestationPolicy {
  kind: typeof MANUAL_SECURITY_ATTESTATION_KIND;
  defaultPath: typeof DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE;
  recordSha256: string | null;
  coveredPackages: readonly string[];
}

export interface ControlPlaneFingerprintSections {
  packages: readonly string[];
  trustedPublisher: DesiredControlPlane["trustedPublisher"];
  workflow: FingerprintWorkflowIdentity;
  environment: DesiredControlPlane["environment"];
  ruleset: DesiredControlPlane["ruleset"];
  readyVariable: typeof READY_VARIABLE_NAME;
  attestationPolicy: FingerprintAttestationPolicy;
}

export interface ControlPlaneFingerprintDocument {
  kind: typeof CONTROL_PLANE_FINGERPRINT_KIND;
  sha256: string;
  packages: string[];
  trustedPublisher: ControlPlaneFingerprintSections["trustedPublisher"];
  workflow: FingerprintWorkflowIdentity;
  environment: ControlPlaneFingerprintSections["environment"];
  ruleset: {
    name: typeof RELEASE_RULESET_NAME;
    target: "tag";
    enforcement: "active";
    include: typeof RELEASE_TAG_INCLUDE;
    rules: string[];
  };
  readyVariable: typeof READY_VARIABLE_NAME;
  attestationPolicy: {
    kind: typeof MANUAL_SECURITY_ATTESTATION_KIND;
    defaultPath: typeof DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE;
    recordSha256: string | null;
    coveredPackages: string[];
  };
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** Canonical JSON: sorted keys, no whitespace, no timestamps. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

export function workflowIdentityFromYaml(
  yaml: string,
  filename: typeof TRUSTED_PUBLISHER_WORKFLOW = TRUSTED_PUBLISHER_WORKFLOW,
): FingerprintWorkflowIdentity {
  return {
    filename,
    environment: RELEASE_ENVIRONMENT_NAME,
    referencesNpmRelease: /environment:\s*npm-release\b/.test(yaml),
    referencesReadyVariable: yaml.includes(READY_VARIABLE_NAME),
  };
}

export function defaultAttestationPolicy(
  recordSha256: string | null = null,
  coveredPackages: readonly string[] = [],
): FingerprintAttestationPolicy {
  return {
    kind: MANUAL_SECURITY_ATTESTATION_KIND,
    defaultPath: DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE,
    recordSha256,
    coveredPackages: [...coveredPackages],
  };
}

export function currentFingerprintSections(
  workflowYaml: string,
  attestationPolicy: FingerprintAttestationPolicy = defaultAttestationPolicy(),
  desired: DesiredControlPlane = desiredControlPlane(),
): ControlPlaneFingerprintSections {
  return {
    packages: [...desired.packages],
    trustedPublisher: { ...desired.trustedPublisher },
    workflow: workflowIdentityFromYaml(workflowYaml, desired.trustedPublisher.workflow),
    environment: { ...desired.environment, deploymentBranches: [...desired.environment.deploymentBranches] },
    ruleset: {
      name: desired.ruleset.name,
      target: desired.ruleset.target,
      enforcement: desired.ruleset.enforcement,
      include: desired.ruleset.include,
      rules: [...desired.ruleset.rules],
    },
    readyVariable: desired.readyVariable,
    attestationPolicy: {
      kind: attestationPolicy.kind,
      defaultPath: attestationPolicy.defaultPath,
      recordSha256: attestationPolicy.recordSha256,
      coveredPackages: [...attestationPolicy.coveredPackages],
    },
  };
}

export function fingerprintCanonicalPayload(
  sections: ControlPlaneFingerprintSections,
): Omit<ControlPlaneFingerprintDocument, "sha256"> {
  return {
    kind: CONTROL_PLANE_FINGERPRINT_KIND,
    packages: [...sections.packages],
    trustedPublisher: { ...sections.trustedPublisher },
    workflow: { ...sections.workflow },
    environment: {
      name: sections.environment.name,
      deploymentBranches: [...sections.environment.deploymentBranches],
      requiredReviewersOptional: sections.environment.requiredReviewersOptional,
    },
    ruleset: {
      name: sections.ruleset.name,
      target: sections.ruleset.target,
      enforcement: sections.ruleset.enforcement,
      include: sections.ruleset.include,
      rules: [...sections.ruleset.rules],
    },
    readyVariable: sections.readyVariable,
    attestationPolicy: {
      kind: sections.attestationPolicy.kind,
      defaultPath: sections.attestationPolicy.defaultPath,
      recordSha256: sections.attestationPolicy.recordSha256,
      coveredPackages: [...sections.attestationPolicy.coveredPackages],
    },
  };
}

export function controlPlaneConfigSha256(sections: ControlPlaneFingerprintSections): string {
  return sha256Hex(stableStringify(fingerprintCanonicalPayload(sections)));
}

export function buildFingerprintDocument(
  sections: ControlPlaneFingerprintSections,
): ControlPlaneFingerprintDocument {
  const payload = fingerprintCanonicalPayload(sections);
  return {
    ...payload,
    sha256: sha256Hex(stableStringify(payload)),
  };
}

export function sectionsFromDocument(
  doc: ControlPlaneFingerprintDocument,
): ControlPlaneFingerprintSections {
  return {
    packages: [...doc.packages],
    trustedPublisher: { ...doc.trustedPublisher },
    workflow: { ...doc.workflow },
    environment: { ...doc.environment },
    ruleset: { ...doc.ruleset, rules: [...doc.ruleset.rules] },
    readyVariable: doc.readyVariable,
    attestationPolicy: {
      kind: doc.attestationPolicy.kind,
      defaultPath: doc.attestationPolicy.defaultPath,
      recordSha256: doc.attestationPolicy.recordSha256,
      coveredPackages: [...doc.attestationPolicy.coveredPackages],
    },
  };
}

export function parseFingerprintDocument(json: unknown): ControlPlaneFingerprintDocument | null {
  if (!json || typeof json !== "object") return null;
  const raw = json as Partial<ControlPlaneFingerprintDocument>;
  if (raw.kind !== CONTROL_PLANE_FINGERPRINT_KIND) return null;
  if (typeof raw.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(raw.sha256)) return null;
  if (!Array.isArray(raw.packages) || raw.packages.some((p) => typeof p !== "string")) return null;
  if (!raw.trustedPublisher || typeof raw.trustedPublisher !== "object") return null;
  if (!raw.workflow || typeof raw.workflow !== "object") return null;
  if (!raw.environment || typeof raw.environment !== "object") return null;
  if (!raw.ruleset || typeof raw.ruleset !== "object") return null;
  if (typeof raw.readyVariable !== "string") return null;
  if (!raw.attestationPolicy || typeof raw.attestationPolicy !== "object") return null;
  return raw as ControlPlaneFingerprintDocument;
}

export function documentIntegrityOk(doc: ControlPlaneFingerprintDocument): boolean {
  const recomputed = controlPlaneConfigSha256(sectionsFromDocument(doc));
  return recomputed === doc.sha256;
}

function sameStringList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export function classifyFingerprintDrift(
  expected: ControlPlaneFingerprintSections,
  actual: ControlPlaneFingerprintSections,
): FingerprintDriftReason | null {
  if (controlPlaneConfigSha256(expected) === controlPlaneConfigSha256(actual)) {
    return null;
  }
  if (!sameStringList(expected.packages, actual.packages)) {
    return "PACKAGE_SET_CHANGED";
  }
  if (stableStringify(expected.trustedPublisher) !== stableStringify(actual.trustedPublisher)) {
    return "PUBLISHER_CONFIG_CHANGED";
  }
  if (stableStringify(expected.workflow) !== stableStringify(actual.workflow)) {
    return "WORKFLOW_CHANGED";
  }
  return "CONFIG_DRIFT";
}

export function liveAuditReason(drift: FingerprintDriftReason | null): string {
  switch (drift) {
    case "PACKAGE_SET_CHANGED":
      return "LIVE AUDIT REQUIRED — PACKAGE SET CHANGED";
    case "PUBLISHER_CONFIG_CHANGED":
      return "LIVE AUDIT REQUIRED — PUBLISHER CONFIG CHANGED";
    case "WORKFLOW_CHANGED":
      return "LIVE AUDIT REQUIRED";
    case "CONFIG_DRIFT":
      return "LIVE AUDIT REQUIRED — CONFIG DRIFT";
    default:
      return "LIVE AUDIT REQUIRED";
  }
}

