import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, sha256Hex, type Action, type ActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { actionVerificationPassed, verifyManifest } from "./verify.js";

const adapter = new PlainTextAdapter();

async function doc(text: string, id = "t") {
  return adapter.toCanonical({ kind: "text", id, text });
}

function wrap(
  docId: string,
  hash: string | undefined,
  actions: Action[],
): ActionManifest {
  return { schema_version: SCHEMA_VERSION, source: { id: docId, hash }, actions };
}

function ev(id: string, text: string) {
  return [{ source_id: id, text }];
}

const base: Omit<Action, "id" | "kind" | "title" | "evidence"> = {
  modality: "unknown",
  actor: { certainty: "unknown" },
  inference: "explicit",
  status: "proposed",
};

describe("Phase 1.1 — per-action verification is independent", () => {
  it("Test A: valid / hallucinated / valid → 2 verified, 1 failed", async () => {
    const text =
      "令和8年10月15日に秋の遠足を実施します。\n健康診断は10月頃の予定です。\n当日は弁当を持参してください。";
    const d = await doc(text, "mixed");
    const manifest = wrap("mixed", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "event",
        title: "秋の遠足を実施する",
        modality: "required",
        temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日", precision: "day" },
        evidence: ev("mixed", "令和8年10月15日に秋の遠足を実施します。"),
      },
      {
        ...base,
        id: "act_002",
        kind: "deadline",
        title: "健康診断の締切(捏造)",
        temporal: { type: "exact", date: "2026-10-01", raw_text: "10月頃", precision: "day" },
        evidence: ev("mixed", "健康診断は10月頃の予定です。"),
      },
      {
        ...base,
        id: "act_003",
        kind: "prepare",
        title: "弁当を持参する",
        modality: "required",
        temporal: { type: "relative", raw_text: "当日", deadline_qualifier: "on_day" },
        evidence: ev("mixed", "当日は弁当を持参してください。"),
      },
    ]);

    const { manifest: out, flags } = verifyManifest(manifest, d);

    expect(flags.passed).toBe(false);
    expect(flags.verified_actions).toBe(2);
    expect(flags.failed_actions).toBe(1);
    expect(out.actions[0]?.status).toBe("verified");
    expect(out.actions[1]?.status).toBe("proposed");
    expect(out.actions[2]?.status).toBe("verified");

    const byId = new Map(flags.actions!.map((r) => [r.action_id, r]));
    expect(byId.get("act_001")!.passed).toBe(true);
    expect(byId.get("act_002")!.passed).toBe(false);
    expect(byId.get("act_002")!.temporal_supported).toBe(false);
    expect(byId.get("act_003")!.passed).toBe(true);
  });

  it("Test B: one Action's evidence failure does not contaminate another Action", async () => {
    const text = "参加確認票を提出してください。\n弁当を持参してください。";
    const d = await doc(text, "evb");
    const manifest = wrap("evb", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "submit",
        title: "参加確認票を提出する",
        modality: "required",
        evidence: ev("evb", "参加確認票を提出してください。"),
      },
      {
        ...base,
        id: "act_002",
        kind: "submit",
        title: "存在しない提出物",
        modality: "required",
        evidence: ev("evb", "この文章は原文に存在しません。"),
      },
    ]);

    const { manifest: out, flags } = verifyManifest(manifest, d);
    const byId = new Map(flags.actions!.map((r) => [r.action_id, r]));

    expect(byId.get("act_001")!.passed).toBe(true);
    expect(byId.get("act_001")!.evidence_supported).toBe(true);
    expect(byId.get("act_001")!.issues).toHaveLength(0);
    expect(byId.get("act_002")!.passed).toBe(false);
    expect(byId.get("act_002")!.evidence_supported).toBe(false);

    expect(out.actions[0]?.status).toBe("verified");
    expect(out.actions[1]?.status).toBe("proposed");
    expect(flags.verified_actions).toBe(1);
  });

  it("Test C: explicit-supported / explicit-missing-text / implicit actors", async () => {
    const text =
      "保護者は書類に署名してください。\n希望者は受付に集合してください。\n弁当を用意してください。";
    const d = await doc(text, "actor");
    const manifest = wrap("actor", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "sign",
        title: "書類に署名する",
        actor: { certainty: "explicit", text: "保護者", role: "guardian" },
        evidence: ev("actor", "保護者は書類に署名してください。"),
      },
      {
        ...base,
        id: "act_002",
        kind: "attend",
        title: "受付に集合する",
        actor: { certainty: "explicit" },
        evidence: ev("actor", "希望者は受付に集合してください。"),
      },
      {
        ...base,
        id: "act_003",
        kind: "prepare",
        title: "弁当を用意する",
        // implicit actor.text is optional and NOT forced to appear verbatim.
        actor: { certainty: "implicit", text: "参加者", role: "participant" },
        evidence: ev("actor", "弁当を用意してください。"),
      },
    ]);

    const { flags } = verifyManifest(manifest, d);
    const byId = new Map(flags.actions!.map((r) => [r.action_id, r]));

    expect(byId.get("act_001")!.actor_supported).toBe(true);
    expect(byId.get("act_002")!.actor_supported).toBe(false);
    expect(byId.get("act_002")!.issues.some((i) => i.code === "ACTOR_TEXT_MISSING")).toBe(true);
    expect(byId.get("act_003")!.actor_supported).toBe(true);
  });

  it("Test C (extra): unknown actor never invents, always supported", async () => {
    const text = "会場は後日お知らせします。";
    const d = await doc(text, "unk");
    const manifest = wrap("unk", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "other",
        title: "会場の連絡",
        actor: { certainty: "unknown" },
        evidence: ev("unk", "会場は後日お知らせします。"),
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.actions![0]!.actor_supported).toBe(true);
  });

  it("Test D: exact valid / approximate preserved / hallucinated exact", async () => {
    const text =
      "令和8年度のお知らせです。\n10月15日にイベントを開催します。\n受付は10月頃の予定です。";
    const d = await doc(text, "temp");
    const manifest = wrap("temp", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "event",
        title: "イベントを開催する",
        modality: "required",
        temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日", precision: "day" },
        evidence: ev("temp", "10月15日にイベントを開催します。"),
      },
      {
        ...base,
        id: "act_002",
        kind: "event",
        title: "受付(概数のまま保持)",
        temporal: { type: "approximate", month: 10, raw_text: "10月頃", precision: "month" },
        evidence: ev("temp", "受付は10月頃の予定です。"),
      },
      {
        ...base,
        id: "act_003",
        kind: "event",
        title: "受付(概数から捏造)",
        temporal: { type: "exact", date: "2026-10-01", raw_text: "10月頃", precision: "day" },
        evidence: ev("temp", "受付は10月頃の予定です。"),
      },
    ]);

    const { flags } = verifyManifest(manifest, d);
    const byId = new Map(flags.actions!.map((r) => [r.action_id, r]));
    expect(byId.get("act_001")!.temporal_supported).toBe(true);
    expect(byId.get("act_002")!.temporal_supported).toBe(true);
    expect(byId.get("act_003")!.temporal_supported).toBe(false);
  });

  it("Test E: source hash mismatch is a manifest-level fatal — nothing is verified", async () => {
    const text = "令和8年10月15日に遠足を実施します。";
    const d = await doc(text, "hash");
    const manifest = wrap("hash", sha256Hex("something else entirely"), [
      {
        ...base,
        id: "act_001",
        kind: "event",
        title: "遠足を実施する",
        modality: "required",
        temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日", precision: "day" },
        evidence: ev("hash", "令和8年10月15日に遠足を実施します。"),
      },
    ]);

    const { manifest: out, flags } = verifyManifest(manifest, d);
    expect(flags.source_hash_matched).toBe(false);
    expect(flags.passed).toBe(false);
    expect(flags.verified_actions).toBe(0);
    // Per-action intrinsic truth is preserved even though promotion is blocked.
    expect(flags.actions![0]!.passed).toBe(true);
    expect(actionVerificationPassed(flags.actions![0]!)).toBe(true);
    expect(out.actions.every((a) => a.status === "proposed")).toBe(true);
  });

  it("keeps already-accepted actions untouched (promotion only lifts proposed)", async () => {
    const text = "参加確認票を提出してください。";
    const d = await doc(text, "acc");
    const manifest = wrap("acc", d.sourceHash, [
      {
        ...base,
        id: "act_001",
        kind: "submit",
        title: "参加確認票を提出する",
        modality: "required",
        status: "accepted",
        evidence: ev("acc", "参加確認票を提出してください。"),
      },
    ]);
    const { manifest: out } = verifyManifest(manifest, d);
    expect(out.actions[0]?.status).toBe("accepted");
  });
});
