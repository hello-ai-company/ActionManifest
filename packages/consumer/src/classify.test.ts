import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type Action,
  type ActionManifest,
  type ActionVerificationResult,
  type VerificationFlags,
} from "@actionmanifest/core";
import { classifyManifest, readyActions } from "./index.js";

function action(id: string, status: Action["status"] = "proposed"): Action {
  return {
    id,
    kind: "submit",
    title: `${id} title`,
    modality: "required",
    actor: { certainty: "unknown" },
    evidence: [{ source_id: "s", text: "quote" }],
    inference: "explicit",
    status,
  };
}

function passedResult(id: string): ActionVerificationResult {
  return {
    action_id: id,
    passed: true,
    evidence_supported: true,
    temporal_supported: true,
    actor_supported: true,
    modality_supported: true,
    negation_conflict: false,
    page_refs_valid: true,
    issues: [],
  };
}

function failedResult(id: string): ActionVerificationResult {
  return {
    ...passedResult(id),
    passed: false,
    temporal_supported: false,
    issues: [
      { code: "TEMPORAL_UNSUPPORTED", message: "declared date not in evidence", action_id: id },
    ],
  };
}

function flags(partial: Partial<VerificationFlags>): VerificationFlags {
  return {
    evidence_supported: true,
    temporal_supported: true,
    actor_supported: true,
    modality_supported: true,
    source_hash_matched: true,
    negation_conflict: false,
    page_refs_valid: true,
    passed: true,
    ...partial,
  };
}

function manifest(
  actions: Action[],
  verification?: VerificationFlags,
): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: "s", hash: "h" },
    actions,
    ...(verification ? { receipt: { extraction: { provider: "t", model: "t", extractor_version: "0", schema_version: SCHEMA_VERSION, created_at: "t" }, verification } } : {}),
  };
}

describe("reference consumer policy", () => {
  it("ready: per-action passed + verified status", () => {
    const m = manifest(
      [action("a1", "verified")],
      flags({ actions: [passedResult("a1")] }),
    );
    const report = classifyManifest(m);
    expect(report.manifestFatal).toBe(false);
    expect(report.actions[0]?.disposition).toBe("ready");
    expect(readyActions(m)).toHaveLength(1);
  });

  it("blocked: per-action failure affects only that action", () => {
    const m = manifest(
      [action("ok", "verified"), action("bad", "proposed")],
      flags({
        passed: false,
        temporal_supported: false,
        actions: [passedResult("ok"), failedResult("bad")],
      }),
    );
    const report = classifyManifest(m);
    expect(report.actions.find((a) => a.action.id === "ok")?.disposition).toBe("ready");
    const bad = report.actions.find((a) => a.action.id === "bad");
    expect(bad?.disposition).toBe("blocked");
    expect(bad?.reasons.map((r) => r.code)).toContain("TEMPORAL_UNSUPPORTED");
    expect(report.counts).toEqual({ ready: 1, review_required: 0, blocked: 1 });
  });

  it("manifest-level fatal (hash mismatch) blocks every action, even intrinsically passed ones", () => {
    const m = manifest(
      [action("a1", "proposed")],
      flags({
        passed: false,
        source_hash_matched: false,
        actions: [passedResult("a1")],
        issues: [{ code: "SOURCE_HASH_MISMATCH", message: "hash mismatch" }],
      }),
    );
    const report = classifyManifest(m);
    expect(report.manifestFatal).toBe(true);
    expect(report.actions[0]?.disposition).toBe("blocked");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("SOURCE_HASH_MISMATCH");
  });

  it("manifest-level fatal (empty source) blocks every action", () => {
    const m = manifest(
      [action("a1", "proposed")],
      flags({
        passed: false,
        issues: [{ code: "EMPTY_SOURCE", message: "no text" }],
        actions: [passedResult("a1")],
      }),
    );
    expect(classifyManifest(m).actions[0]?.disposition).toBe("blocked");
  });

  it("review_required: no verification receipt at all", () => {
    const m = manifest([action("a1")]);
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("review_required");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("VERIFICATION_MISSING");
  });

  it("blocked: human-rejected action stays blocked even with a passing receipt", () => {
    const m = manifest(
      [action("a1", "rejected")],
      flags({ actions: [passedResult("a1")] }),
    );
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("blocked");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("ACTION_REJECTED");
  });

  it("review_required: passed but never promoted (status still proposed)", () => {
    const m = manifest(
      [action("a1", "proposed")],
      flags({ actions: [passedResult("a1")] }),
    );
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("review_required");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("PASSED_NOT_PROMOTED");
  });

  it("v0.1 aggregate receipt: clean aggregate + verified status → ready", () => {
    const m = manifest([action("a1", "verified")], flags({ actions: undefined }));
    expect(classifyManifest(m).actions[0]?.disposition).toBe("ready");
  });

  it("v0.1 aggregate receipt: any aggregate failure → review_required (cannot attribute)", () => {
    const m = manifest(
      [action("a1", "proposed")],
      flags({ passed: false, temporal_supported: false, actions: undefined }),
    );
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("review_required");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("PER_ACTION_RESULT_MISSING");
  });

  it("ready actions surface warnings as reasons without blocking", () => {
    const withWarning: ActionVerificationResult = {
      ...passedResult("a1"),
      issues: [{ code: "SOME_WARNING", message: "note", severity: "warning" }],
    };
    const m = manifest([action("a1", "verified")], flags({ actions: [withWarning] }));
    const report = classifyManifest(m);
    expect(report.actions[0]?.disposition).toBe("ready");
    expect(report.actions[0]?.reasons.map((r) => r.code)).toContain("SOME_WARNING");
  });
});
