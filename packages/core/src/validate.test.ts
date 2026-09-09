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

  it("still accepts legacy 0.1.0 manifests (backward compatible)", () => {
    const m = validateActionManifest({
      schema_version: "0.1.0",
      source: { id: "doc" },
      actions: [validAction],
    });
    expect(m.schema_version).toBe("0.1.0");
  });

  it("accepts a 0.2.0 manifest with a per-action verification receipt", () => {
    const m = validateActionManifest({
      schema_version: "0.2.0",
      source: { id: "doc" },
      actions: [validAction],
      receipt: {
        extraction: {
          provider: "deterministic",
          model: "notice-rules-v0.1",
          extractor_version: "0.1.0",
          schema_version: "0.2.0",
          created_at: "2026-09-09T00:00:00.000Z",
        },
        verification: {
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
        },
      },
    });
    expect(m.receipt?.verification?.actions?.[0]?.action_id).toBe("act_001");
  });

  const receiptWith = (actionResult: Record<string, unknown>) => ({
    schema_version: "0.2.0",
    source: { id: "doc" },
    actions: [validAction],
    receipt: {
      extraction: {
        provider: "deterministic",
        model: "m",
        extractor_version: "0.1.0",
        schema_version: "0.2.0",
        created_at: "2026-09-09T00:00:00.000Z",
      },
      verification: {
        evidence_supported: true,
        temporal_supported: true,
        actor_supported: true,
        modality_supported: true,
        source_hash_matched: true,
        negation_conflict: false,
        page_refs_valid: true,
        actions: [actionResult],
      },
    },
  });

  it("rejects a per-action result missing action_id", () => {
    expect(() =>
      validateActionManifest(
        receiptWith({
          passed: true,
          evidence_supported: true,
          temporal_supported: true,
          actor_supported: true,
          modality_supported: true,
          negation_conflict: false,
          page_refs_valid: true,
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it("rejects a per-action result with a non-boolean flag", () => {
    expect(() =>
      validateActionManifest(
        receiptWith({
          action_id: "act_001",
          passed: "yes",
          evidence_supported: true,
          temporal_supported: true,
          actor_supported: true,
          modality_supported: true,
          negation_conflict: false,
          page_refs_valid: true,
        }),
      ),
    ).toThrow(SchemaValidationError);
  });

  it("rejects unknown properties in a per-action result", () => {
    expect(() =>
      validateActionManifest(
        receiptWith({
          action_id: "act_001",
          passed: true,
          evidence_supported: true,
          temporal_supported: true,
          actor_supported: true,
          modality_supported: true,
          negation_conflict: false,
          page_refs_valid: true,
          bogus_field: 1,
        }),
      ),
    ).toThrow(SchemaValidationError);
  });
});
