import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION } from "@actionmanifest/schema";
import {
  SchemaValidationError,
  validateActionManifest,
  validateCanonicalDocument,
} from "@actionmanifest/core";

const validAction = {
  id: "act_001",
  kind: "submit",
  title: "提出する",
  modality: "required",
  actor: { certainty: "unknown" },
  evidence: [{ source_id: "doc", text: "提出してください" }],
  inference: "explicit",
  status: "proposed",
};

describe("schema", () => {
  it("accepts a minimal valid manifest", () => {
    const m = validateActionManifest({
      schema_version: SCHEMA_VERSION,
      source: { id: "doc" },
      actions: [validAction],
    });
    expect(m.actions).toHaveLength(1);
  });

  it("rejects actions without evidence", () => {
    expect(() =>
      validateActionManifest({
        schema_version: SCHEMA_VERSION,
        source: { id: "doc" },
        actions: [{ ...validAction, evidence: [] }],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("rejects unknown schema versions", () => {
    expect(() =>
      validateActionManifest({
        schema_version: "9.9.9",
        source: { id: "doc" },
        actions: [validAction],
      }),
    ).toThrow(SchemaValidationError);
  });

  it("allows x- extension kinds", () => {
    const m = validateActionManifest({
      schema_version: SCHEMA_VERSION,
      source: { id: "doc" },
      actions: [{ ...validAction, kind: "x-custom-kind" }],
    });
    expect(m.actions[0]?.kind).toBe("x-custom-kind");
  });

  it("validates canonical documents", () => {
    const doc = validateCanonicalDocument({
      id: "d1",
      text: "hello",
      pages: [{ pageNumber: 1, text: "hello" }],
    });
    expect(doc.id).toBe("d1");
  });
});
