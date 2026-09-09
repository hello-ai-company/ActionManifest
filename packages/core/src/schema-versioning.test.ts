import { describe, expect, it } from "vitest";
import {
  actionManifestSchemaV01,
  actionManifestSchemaV02,
} from "@actionmanifest/schema";
import { SchemaValidationError, validateActionManifest } from "@actionmanifest/core";

const action = {
  id: "act_001",
  kind: "submit",
  title: "提出する",
  modality: "required",
  actor: { certainty: "unknown" },
  evidence: [{ source_id: "doc", text: "提出してください" }],
  inference: "explicit",
  status: "proposed",
};

const v02Verification = {
  evidence_supported: true,
  temporal_supported: true,
  actor_supported: true,
  modality_supported: true,
  source_hash_matched: true,
  negation_conflict: false,
  page_refs_valid: true,
  passed: true,
  total_actions: 1,
  verified_actions: 1,
  failed_actions: 0,
  warning_actions: 0,
  actions: [
    {
      action_id: "act_001",
      passed: true,
      evidence_supported: true,
      temporal_supported: true,
      actor_supported: true,
      modality_supported: true,
      negation_conflict: false,
      page_refs_valid: true,
      issues: [],
    },
  ],
};

const extraction = {
  provider: "deterministic",
  model: "m",
  extractor_version: "0.1.0",
  schema_version: "0.2.0",
  created_at: "2026-09-09T00:00:00.000Z",
};

describe("immutable versioned schemas — reader dispatch by schema_version", () => {
  it("v0.1 manifest with 0.1 fields → PASS", () => {
    const m = validateActionManifest({
      schema_version: "0.1.0",
      source: { id: "doc" },
      actions: [action],
    });
    expect(m.schema_version).toBe("0.1.0");
  });

  it("v0.2 manifest with 0.2 fields → PASS", () => {
    const m = validateActionManifest({
      schema_version: "0.2.0",
      source: { id: "doc" },
      actions: [action],
      receipt: { extraction, verification: v02Verification },
    });
    expect(m.receipt?.verification?.actions?.[0]?.action_id).toBe("act_001");
  });

  it("v0.1 manifest carrying v0.2-only verification.actions → FAIL", () => {
    expect(() =>
      validateActionManifest({
        schema_version: "0.1.0",
        source: { id: "doc" },
        actions: [action],
        receipt: {
          extraction: { ...extraction, schema_version: "0.1.0" },
          verification: {
            evidence_supported: true,
            temporal_supported: true,
            actor_supported: true,
            modality_supported: true,
            source_hash_matched: true,
            negation_conflict: false,
            page_refs_valid: true,
            actions: [],
          },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("v0.1 manifest carrying v0.2-only scalar fields (passed/verified_actions) → FAIL", () => {
    expect(() =>
      validateActionManifest({
        schema_version: "0.1.0",
        source: { id: "doc" },
        actions: [action],
        receipt: {
          extraction: { ...extraction, schema_version: "0.1.0" },
          verification: {
            evidence_supported: true,
            temporal_supported: true,
            actor_supported: true,
            modality_supported: true,
            source_hash_matched: true,
            negation_conflict: false,
            page_refs_valid: true,
            passed: true,
            verified_actions: 1,
          },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("v0.2 manifest with a malformed per-action result → FAIL", () => {
    expect(() =>
      validateActionManifest({
        schema_version: "0.2.0",
        source: { id: "doc" },
        actions: [action],
        receipt: {
          extraction,
          verification: {
            ...v02Verification,
            actions: [{ action_id: "act_001", passed: "yes" }],
          },
        },
      }),
    ).toThrow(SchemaValidationError);
  });

  it("unknown schema_version 0.3.0 → UNSUPPORTED", () => {
    expect(() =>
      validateActionManifest({
        schema_version: "0.3.0",
        source: { id: "doc" },
        actions: [action],
      }),
    ).toThrow(/Unsupported schema_version 0\.3\.0/);
  });

  it("missing schema_version → FAIL (fail closed)", () => {
    expect(() =>
      validateActionManifest({ source: { id: "doc" }, actions: [action] }),
    ).toThrow(SchemaValidationError);
  });

  it("non-object input → FAIL (fail closed)", () => {
    expect(() => validateActionManifest(null)).toThrow(SchemaValidationError);
    expect(() => validateActionManifest("0.2.0")).toThrow(SchemaValidationError);
    expect(() => validateActionManifest([])).toThrow(SchemaValidationError);
  });
});

const constVersion = (schema: Record<string, unknown>): unknown => {
  const props = schema.properties as Record<string, Record<string, unknown>> | undefined;
  return props?.schema_version?.const;
};

describe("schema identity", () => {
  it("v0.1 $id contains /v0.1/ and const 0.1.0", () => {
    expect(String(actionManifestSchemaV01.$id)).toContain("/v0.1/");
    expect(constVersion(actionManifestSchemaV01)).toBe("0.1.0");
  });

  it("v0.2 $id contains /v0.2/ and const 0.2.0", () => {
    expect(String(actionManifestSchemaV02.$id)).toContain("/v0.2/");
    expect(constVersion(actionManifestSchemaV02)).toBe("0.2.0");
  });

  it("v0.1 schema is frozen — no per-action verification fields", () => {
    const text = JSON.stringify(actionManifestSchemaV01);
    expect(text).not.toContain("ActionVerificationResult");
    expect(text).not.toContain("verified_actions");
  });

  it("v0.2 schema defines per-action verification", () => {
    const text = JSON.stringify(actionManifestSchemaV02);
    expect(text).toContain("ActionVerificationResult");
    expect(text).toContain("verified_actions");
  });
});
