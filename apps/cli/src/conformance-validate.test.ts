import { describe, expect, it } from "vitest";
import {
  ConformanceConfigError,
  validateSuiteManifest,
  validateVector,
} from "./conformance-validate.js";

/**
 * Normative test data is code: malformed vectors must be runner/config errors
 * (exit 2), never silently ignored. A typo'd expectation field would
 * otherwise let implementations "pass" against a vector that checks nothing.
 */

const validTrustVector = {
  id: "neg-001",
  profile: "trust",
  input: {
    action: { id: "act_001" },
    verification: null,
  },
  expected: {
    ready: false,
    reason: "VERIFICATION_MISSING",
    disposition: "review_required",
    exportable_default: false,
  },
};

const validManifest = {
  suite: "actionmanifest-conformance",
  suite_version: "0.2.0",
  schema_versions: ["0.1.0", "0.2.0"],
  profiles: ["schema", "canonical-document", "evidence", "trust", "temporal", "ics"],
  reference_profiles: ["reference-serialization"],
  smoke_profiles: ["trust", "ics"],
};

describe("validateVector", () => {
  it("accepts a valid trust vector", () => {
    expect(() => validateVector(validTrustVector, "trust")).not.toThrowError();
  });

  it("rejects an unknown expectation field (typo guard)", () => {
    const bad = {
      ...validTrustVector,
      expected: { ...validTrustVector.expected, not_a_real_field: true },
    };
    expect(() => validateVector(bad, "trust")).toThrowError(ConformanceConfigError);
  });

  it("rejects the classic not_contians typo in ics vectors", () => {
    const bad = {
      id: "ics-typo-001",
      profile: "ics",
      input: { manifest: {} },
      expected: { not_contians: ["20990101"] },
    };
    expect(() => validateVector(bad, "ics")).toThrowError(ConformanceConfigError);
  });

  it("rejects a missing id", () => {
    const { id: _omit, ...rest } = validTrustVector;
    expect(() => validateVector(rest, "trust")).toThrowError(ConformanceConfigError);
  });

  it("rejects an unknown profile", () => {
    const bad = { ...validTrustVector, profile: "not-a-profile" };
    expect(() => validateVector(bad, "not-a-profile")).toThrowError(ConformanceConfigError);
  });

  it("rejects a wrong expected type", () => {
    const bad = { ...validTrustVector, expected: { ...validTrustVector.expected, ready: "yes" } };
    expect(() => validateVector(bad, "trust")).toThrowError(ConformanceConfigError);
  });

  it("rejects a directory/profile mismatch", () => {
    expect(() => validateVector(validTrustVector, "ics")).toThrowError(ConformanceConfigError);
  });

  it("forbids byte-exact goldens in the universal ics profile", () => {
    const bad = {
      id: "ics-golden-001",
      profile: "ics",
      input: { manifest: {} },
      expected: { golden: "golden/x.ics" },
    };
    expect(() => validateVector(bad, "ics")).toThrowError(ConformanceConfigError);
  });

  it("requires golden in reference-serialization vectors", () => {
    const bad = {
      id: "ref-001",
      profile: "reference-serialization",
      input: { manifest: {} },
      expected: { contains: ["BEGIN:VCALENDAR"] },
    };
    expect(() => validateVector(bad, "reference-serialization")).toThrowError(ConformanceConfigError);
  });
});

describe("validateSuiteManifest", () => {
  it("accepts the valid suite manifest shape", () => {
    expect(validateSuiteManifest(validManifest).suite_version).toBe("0.2.0");
  });

  it("rejects unknown top-level fields", () => {
    expect(() =>
      validateSuiteManifest({ ...validManifest, not_a_field: 1 }),
    ).toThrowError(ConformanceConfigError);
  });

  it("rejects smoke_profiles that are not a subset of profiles", () => {
    expect(() =>
      validateSuiteManifest({ ...validManifest, smoke_profiles: ["trust", "nope"] }),
    ).toThrowError(ConformanceConfigError);
  });

  it("rejects duplicate profile names", () => {
    expect(() =>
      validateSuiteManifest({ ...validManifest, profiles: [...validManifest.profiles, "trust"] }),
    ).toThrowError(ConformanceConfigError);
  });

  it("rejects a non-semver suite_version", () => {
    expect(() =>
      validateSuiteManifest({ ...validManifest, suite_version: "latest" }),
    ).toThrowError(ConformanceConfigError);
  });
});
