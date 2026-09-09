import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Action, type ActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { verifyManifest } from "./verify.js";

const adapter = new PlainTextAdapter();
async function doc(text: string, id: string) {
  return adapter.toCanonical({ kind: "text", id, text });
}
function wrap(sourceId: string, hash: string | undefined, actions: Action[]): ActionManifest {
  return { schema_version: SCHEMA_VERSION, source: { id: sourceId, hash }, actions };
}

const A = (id: string, sourceId: string, text: string): Action => ({
  id,
  kind: "submit",
  title: "提出する",
  modality: "required",
  actor: { certainty: "unknown" },
  evidence: [{ source_id: sourceId, text }],
  inference: "explicit",
  status: "proposed",
});

describe("Phase 1.1 hardening — evidence source identity is a per-action trust condition", () => {
  it("source_id == manifest.source.id → supported (PASS)", async () => {
    const d = await doc("参加確認票を提出してください。", "canon-doc");
    const m = wrap("manifest-src", undefined, [A("act_001", "manifest-src", "参加確認票を提出してください。")]);
    const { flags } = verifyManifest(m, d);
    expect(flags.actions![0]!.evidence_supported).toBe(true);
    expect(flags.actions![0]!.passed).toBe(true);
  });

  it("source_id == canonical doc.id → supported (PASS)", async () => {
    const d = await doc("参加確認票を提出してください。", "canon-doc");
    const m = wrap("manifest-src", undefined, [A("act_001", "canon-doc", "参加確認票を提出してください。")]);
    const { flags } = verifyManifest(m, d);
    expect(flags.actions![0]!.evidence_supported).toBe(true);
    expect(flags.actions![0]!.passed).toBe(true);
  });

  it("wrong source_id but valid quote → Action FAILS (per-action provenance failure)", async () => {
    const d = await doc("参加確認票を提出してください。", "canon-doc");
    const m = wrap("canon-doc", undefined, [A("act_001", "unrelated-doc", "参加確認票を提出してください。")]);
    const { manifest: out, flags } = verifyManifest(m, d);
    const r = flags.actions![0]!;
    expect(r.evidence_supported).toBe(false);
    expect(r.passed).toBe(false);
    // The quote itself IS in the source — only the identity is wrong.
    expect(r.issues.some((i) => i.code === "EVIDENCE_SOURCE_ID")).toBe(true);
    expect(r.issues.some((i) => i.code === "EVIDENCE_NOT_IN_SOURCE")).toBe(false);
    // EVIDENCE_SOURCE_ID must be an error, not a warning.
    expect(r.issues.find((i) => i.code === "EVIDENCE_SOURCE_ID")?.severity).toBe("error");
    expect(out.actions[0]?.status).toBe("proposed");
    // Not fatal — this is per-action, not manifest-level.
    expect(flags.source_hash_matched).toBe(true);
  });

  it("mixed manifest: only the wrong-source_id Action fails; others verify", async () => {
    const d = await doc(
      "参加確認票を提出してください。\n健康カードを提出してください。\n弁当を持参してください。",
      "canon-doc",
    );
    const m = wrap("canon-doc", d.sourceHash, [
      A("act_001", "canon-doc", "参加確認票を提出してください。"),
      A("act_002", "unrelated-doc", "健康カードを提出してください。"),
      { ...A("act_003", "canon-doc", "弁当を持参してください。"), kind: "prepare", title: "弁当を持参する" },
    ]);
    const { manifest: out, flags } = verifyManifest(m, d);
    const byId = new Map(flags.actions!.map((r) => [r.action_id, r]));
    expect(byId.get("act_001")!.passed).toBe(true);
    expect(byId.get("act_002")!.passed).toBe(false);
    expect(byId.get("act_002")!.issues.some((i) => i.code === "EVIDENCE_SOURCE_ID")).toBe(true);
    expect(byId.get("act_003")!.passed).toBe(true);
    // act_001's result is not contaminated by act_002.
    expect(byId.get("act_001")!.issues).toHaveLength(0);
    expect(flags.verified_actions).toBe(2);
    expect(flags.failed_actions).toBe(1);
    expect(out.actions[1]?.status).toBe("proposed");
    // A source-id mismatch is an error, so it must NOT be counted as a warning.
    expect(flags.warning_actions).toBe(0);
  });
});
