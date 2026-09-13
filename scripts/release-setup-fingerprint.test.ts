import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  CONTROL_PLANE_FINGERPRINT_KIND,
  CONTROL_PLANE_FINGERPRINT_RELATIVE,
  buildFingerprintDocument,
  classifyFingerprintDrift,
  controlPlaneConfigSha256,
  currentFingerprintSections,
  defaultAttestationPolicy,
  documentIntegrityOk,
  liveAuditReason,
  parseFingerprintDocument,
  sectionsFromDocument,
  sha256Hex,
  stableStringify,
  workflowIdentityFromYaml,
} from "./release-setup-fingerprint.js";
import { READY_VARIABLE_NAME, desiredControlPlane } from "./release-setup-plan.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

function realWorkflow(): string {
  return readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
}

describe("CONTROL_PLANE_CONFIG_SHA256", () => {
  it("is deterministic, 64 hex chars, and ignores key order", () => {
    const sections = currentFingerprintSections(realWorkflow());
    const a = controlPlaneConfigSha256(sections);
    const b = controlPlaneConfigSha256(currentFingerprintSections(realWorkflow()));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it("committed snapshot matches current desired config + release.yml", () => {
    const raw = JSON.parse(
      readFileSync(join(root, CONTROL_PLANE_FINGERPRINT_RELATIVE), "utf8"),
    ) as unknown;
    const doc = parseFingerprintDocument(raw);
    expect(doc).not.toBeNull();
    expect(doc?.kind).toBe(CONTROL_PLANE_FINGERPRINT_KIND);
    expect(documentIntegrityOk(doc!)).toBe(true);
    const current = buildFingerprintDocument(currentFingerprintSections(realWorkflow()));
    expect(doc!.sha256).toBe(current.sha256);
    expect(doc!.packages).toEqual([...PUBLIC_PACKAGE_NAMES]);
    expect(doc!.trustedPublisher).toEqual(desiredControlPlane().trustedPublisher);
    expect(doc!.readyVariable).toBe(READY_VARIABLE_NAME);
    expect(JSON.stringify(doc)).not.toMatch(/OTP|NPM_TOKEN|Authorization|cookie/i);
  });

  it("classifies package-set / publisher / workflow / generic drift", () => {
    const base = currentFingerprintSections(realWorkflow());
    expect(classifyFingerprintDrift(base, base)).toBeNull();

    const packages = { ...base, packages: [...base.packages, "@actionmanifest/extra"] };
    expect(classifyFingerprintDrift(base, packages)).toBe("PACKAGE_SET_CHANGED");
    expect(liveAuditReason("PACKAGE_SET_CHANGED")).toBe("LIVE AUDIT REQUIRED — PACKAGE SET CHANGED");

    const publisher = {
      ...base,
      trustedPublisher: { ...base.trustedPublisher, workflow: "other.yml" as "release.yml" },
    };
    expect(classifyFingerprintDrift(base, publisher)).toBe("PUBLISHER_CONFIG_CHANGED");
    expect(liveAuditReason("PUBLISHER_CONFIG_CHANGED")).toBe(
      "LIVE AUDIT REQUIRED — PUBLISHER CONFIG CHANGED",
    );

    const workflow = {
      ...base,
      workflow: { ...base.workflow, referencesNpmRelease: false },
    };
    expect(classifyFingerprintDrift(base, workflow)).toBe("WORKFLOW_CHANGED");
    expect(liveAuditReason("WORKFLOW_CHANGED")).toBe("LIVE AUDIT REQUIRED");

    const ruleset = {
      ...base,
      ruleset: { ...base.ruleset, include: "refs/tags/other*" as "refs/tags/v*" },
    };
    expect(classifyFingerprintDrift(base, ruleset)).toBe("CONFIG_DRIFT");
    expect(liveAuditReason("CONFIG_DRIFT")).toBe("LIVE AUDIT REQUIRED — CONFIG DRIFT");
  });

  it("workflow identity reads environment + READY references; attestation policy is not live proof", () => {
    const id = workflowIdentityFromYaml(realWorkflow());
    expect(id.filename).toBe("release.yml");
    expect(id.environment).toBe("npm-release");
    expect(id.referencesNpmRelease).toBe(true);
    expect(id.referencesReadyVariable).toBe(true);
    const policy = defaultAttestationPolicy();
    expect(policy.recordSha256).toBeNull();
    expect(policy.coveredPackages).toEqual([]);
    expect(sha256Hex("abc")).toHaveLength(64);
    const doc = buildFingerprintDocument(currentFingerprintSections(realWorkflow()));
    expect(sectionsFromDocument(doc).attestationPolicy.recordSha256).toBeNull();
  });
});
