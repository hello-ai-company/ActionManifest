import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  EXAMPLE_MANUAL_SECURITY_ATTESTATION_RELATIVE,
  idleAttestation,
  loadManualSecurityAttestation,
  toAttestationApplication,
  validateManualSecurityAttestation,
} from "./release-setup-attestation.js";
import { readFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function validRecord() {
  return {
    kind: "actionmanifest-manual-package-security-attestation",
    attestedBy: "release-maintainer",
    attestedAt: "2026-09-12T05:00:00Z",
    packages: [...PUBLIC_PACKAGE_NAMES],
    verifiedInNpmUi:
      "npmjs Settings → Publishing access: Require two-factor authentication and disallow tokens (all 10 packages)",
    notes: "checked in npm UI; no tokens stored",
  };
}

describe("manual security attestation validator", () => {
  it("accepts a non-secret maintainer record covering public packages", () => {
    const result = validateManualSecurityAttestation(validRecord());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.record.packages).toHaveLength(PUBLIC_PACKAGE_NAMES.length);
      expect(result.record.attestedBy).toBe("release-maintainer");
    }
  });

  it("rejects placeholders, empty reads, unknown packages, and secret-shaped keys", () => {
    expect(validateManualSecurityAttestation({}).ok).toBe(false);
    expect(validateManualSecurityAttestation({ ...validRecord(), attestedBy: "_EXAMPLE_DO_NOT_USE" }).ok).toBe(
      false,
    );
    expect(validateManualSecurityAttestation({ ...validRecord(), attestedAt: "yesterday" }).ok).toBe(false);
    expect(validateManualSecurityAttestation({ ...validRecord(), packages: [] }).ok).toBe(false);
    expect(
      validateManualSecurityAttestation({ ...validRecord(), packages: ["@not/a-public-package"] }).ok,
    ).toBe(false);
    expect(
      validateManualSecurityAttestation({
        ...validRecord(),
        verifiedInNpmUi: "looked at the website",
      }).ok,
    ).toBe(false);
    expect(
      validateManualSecurityAttestation({
        ...validRecord(),
        otp: "123456",
      }).ok,
    ).toBe(false);
    expect(
      validateManualSecurityAttestation({
        ...validRecord(),
        notes: "Authorization: Bearer supersecret",
      }).ok,
    ).toBe(false);
  });

  it("does not apply a file unless --attest-manual-security requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-attest-"));
    const path = join(dir, "ok.json");
    writeFileSync(path, JSON.stringify(validRecord()), "utf8");
    const idle = loadManualSecurityAttestation({ requested: false, path });
    expect(idle.requested).toBe(false);
    expect(idle.applied).toBe(false);
    expect(idle.loaded).toBe(false);
    const application = toAttestationApplication(idle);
    expect(application.requested).toBe(false);
    expect(application.applied).toBe(false);
    expect(application.coveredPackages).toEqual([]);
    expect(idleAttestation().applied).toBe(false);
  });

  it("never fakes OK from a missing or empty attestation when requested", () => {
    const dir = mkdtempSync(join(tmpdir(), "am-attest-"));
    const missing = loadManualSecurityAttestation({
      requested: true,
      path: join(dir, "does-not-exist.json"),
    });
    expect(missing.applied).toBe(false);
    expect(missing.error).toMatch(/missing/);
    const emptyPath = join(dir, "empty.json");
    writeFileSync(emptyPath, "  \n", "utf8");
    const empty = loadManualSecurityAttestation({ requested: true, path: emptyPath });
    expect(empty.loaded).toBe(true);
    expect(empty.applied).toBe(false);
    expect(empty.error).toMatch(/empty/);
  });

  it("committed example cannot unblock READY", () => {
    const example = JSON.parse(
      readFileSync(join(root, EXAMPLE_MANUAL_SECURITY_ATTESTATION_RELATIVE), "utf8"),
    ) as unknown;
    const result = validateManualSecurityAttestation(example);
    expect(result.ok).toBe(false);
  });
});
