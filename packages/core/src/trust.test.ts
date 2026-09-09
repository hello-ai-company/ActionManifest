import { describe, expect, it } from "vitest";
import {
  evaluateActionTrust,
  trustDispositionFor,
  type Action,
  type ActionVerificationResult,
  type VerificationFlags,
} from "./index.js";

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

function flags(partial: Partial<VerificationFlags> = {}): VerificationFlags {
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

describe("evaluateActionTrust", () => {
  it("READY: per-action passed + verified-tier status + no fatal", () => {
    for (const status of ["verified", "accepted", "exported"] as const) {
      const t = evaluateActionTrust(action("a1", status), flags({ actions: [passedResult("a1")] }));
      expect(t.ready).toBe(true);
      expect(t.reason).toBe("READY");
    }
  });

  it("VERIFICATION_FAILED: status=verified but per-action receipt failed", () => {
    const t = evaluateActionTrust(
      action("a1", "verified"),
      flags({ passed: false, actions: [failedResult("a1")] }),
    );
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("VERIFICATION_FAILED");
    expect(t.issues?.map((i) => i.code)).toContain("TEMPORAL_UNSUPPORTED");
  });

  it("VERIFICATION_MISSING: status=verified but no receipt at all", () => {
    const t = evaluateActionTrust(action("a1", "verified"), undefined);
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("VERIFICATION_MISSING");
  });

  it("STATUS_NOT_VERIFIED_TIER: per-action passed but status still proposed", () => {
    const t = evaluateActionTrust(action("a1", "proposed"), flags({ actions: [passedResult("a1")] }));
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("STATUS_NOT_VERIFIED_TIER");
  });

  it("ACTION_REJECTED: rejected stays untrusted even with a passing receipt", () => {
    const t = evaluateActionTrust(action("a1", "rejected"), flags({ actions: [passedResult("a1")] }));
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("ACTION_REJECTED");
  });

  it("MANIFEST_FATAL: hash mismatch blocks even an intrinsically passed action", () => {
    const t = evaluateActionTrust(
      action("a1", "verified"),
      flags({
        passed: false,
        source_hash_matched: false,
        actions: [passedResult("a1")],
        issues: [{ code: "SOURCE_HASH_MISMATCH", message: "hash mismatch" }],
      }),
    );
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("MANIFEST_FATAL");
    expect(t.fatal?.map((f) => f.code)).toContain("SOURCE_HASH_MISMATCH");
  });

  it("MANIFEST_FATAL: empty source blocks everything", () => {
    const t = evaluateActionTrust(
      action("a1", "verified"),
      flags({
        passed: false,
        issues: [{ code: "EMPTY_SOURCE", message: "no text" }],
        actions: [passedResult("a1")],
      }),
    );
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("MANIFEST_FATAL");
  });

  it("v0.1 receipt (no per-action results): clean aggregate + verified-tier → READY", () => {
    const t = evaluateActionTrust(action("a1", "verified"), flags({ actions: undefined }));
    expect(t.ready).toBe(true);
    expect(t.reason).toBe("READY");
  });

  it("v0.1 receipt: clean aggregate + proposed → STATUS_NOT_VERIFIED_TIER", () => {
    const t = evaluateActionTrust(action("a1", "proposed"), flags({ actions: undefined }));
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("STATUS_NOT_VERIFIED_TIER");
  });

  it("v0.1 receipt: failing aggregate cannot be attributed → PER_ACTION_RESULT_MISSING", () => {
    const t = evaluateActionTrust(
      action("a1", "verified"),
      flags({ passed: false, temporal_supported: false, actions: undefined }),
    );
    expect(t.ready).toBe(false);
    expect(t.reason).toBe("PER_ACTION_RESULT_MISSING");
  });
});

describe("trustDispositionFor", () => {
  it("maps trust reasons to the shared disposition vocabulary", () => {
    expect(trustDispositionFor("READY")).toBe("ready");
    expect(trustDispositionFor("MANIFEST_FATAL")).toBe("blocked");
    expect(trustDispositionFor("ACTION_REJECTED")).toBe("blocked");
    expect(trustDispositionFor("VERIFICATION_FAILED")).toBe("blocked");
    expect(trustDispositionFor("VERIFICATION_MISSING")).toBe("review_required");
    expect(trustDispositionFor("PER_ACTION_RESULT_MISSING")).toBe("review_required");
    expect(trustDispositionFor("STATUS_NOT_VERIFIED_TIER")).toBe("review_required");
  });
});
