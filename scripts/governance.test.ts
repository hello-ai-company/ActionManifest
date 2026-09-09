import { describe, expect, it } from "vitest";
import {
  findFrozenViolations,
  findSuiteVersionViolation,
  isFrozenSchemaPath,
  isNormativeConformancePath,
} from "./governance.js";

/**
 * Governance guard logic, tested as pure functions over changed-path lists —
 * no real working tree is touched.
 */

describe("frozen schema path guard", () => {
  it("flags v0.2 schema modification", () => {
    expect(
      findFrozenViolations(["packages/schema/schemas/v0.2/action-manifest.schema.json"]),
    ).toEqual(["packages/schema/schemas/v0.2/action-manifest.schema.json"]);
  });

  it("flags v0.1 schema modification", () => {
    expect(isFrozenSchemaPath("packages/schema/schemas/v0.1/action-manifest.schema.json")).toBe(true);
  });

  it("checksums.json alone is NOT a frozen schema modification (but cannot bless one either)", () => {
    expect(findFrozenViolations(["packages/schema/schemas/checksums.json"])).toEqual([]);
  });

  it("schema + checksums edited together is still a violation", () => {
    const changed = [
      "packages/schema/schemas/v0.2/action-manifest.schema.json",
      "packages/schema/schemas/checksums.json",
    ];
    expect(findFrozenViolations(changed)).toEqual([
      "packages/schema/schemas/v0.2/action-manifest.schema.json",
    ]);
  });

  it("unrelated changes are fine", () => {
    expect(findFrozenViolations(["packages/core/src/trust.ts", "docs/x.md"])).toEqual([]);
  });
});

describe("suite version guard", () => {
  it("normative vector changed + suite_version unchanged → violation", () => {
    const msg = findSuiteVersionViolation(
      ["conformance/vectors/trust/failed-verified-001.json"],
      "0.2.0",
      "0.2.0",
    );
    expect(msg).toMatch(/suite_version is unchanged/);
  });

  it("normative vector changed + suite_version bumped → allowed", () => {
    expect(
      findSuiteVersionViolation(["conformance/vectors/trust/failed-verified-001.json"], "0.2.0", "0.3.0"),
    ).toBeUndefined();
  });

  it("vector schema changed + suite_version unchanged → violation", () => {
    expect(
      findSuiteVersionViolation(["conformance/schema/profiles/trust.schema.json"], "0.2.0", "0.2.0"),
    ).toMatch(/suite_version/);
  });

  it("suite manifest itself changed + version unchanged → violation", () => {
    expect(
      findSuiteVersionViolation(["conformance/manifest.json"], "0.2.0", "0.2.0"),
    ).toMatch(/suite_version/);
  });

  it("docs-only change + version unchanged → allowed", () => {
    expect(
      findSuiteVersionViolation(["docs/CONFORMANCE.md", "README.md"], "0.2.0", "0.2.0"),
    ).toBeUndefined();
  });

  it("reference-serialization golden change does NOT require a suite bump", () => {
    expect(
      isNormativeConformancePath("conformance/vectors/reference-serialization/golden/x.ics"),
    ).toBe(false);
    expect(
      findSuiteVersionViolation(
        ["conformance/vectors/reference-serialization/vevent-exact-001.json"],
        "0.2.0",
        "0.2.0",
      ),
    ).toBeUndefined();
  });

  it("suite introduced in this diff (no base version) → allowed", () => {
    expect(
      findSuiteVersionViolation(["conformance/vectors/trust/x.json"], undefined, "0.1.0"),
    ).toBeUndefined();
  });
});
