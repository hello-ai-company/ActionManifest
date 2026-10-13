import { describe, expect, it } from "vitest";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { SCHEMA_VERSION, type Action } from "@actionmanifest/core";
import { verifyManifest } from "./verify.js";

const action = (text: string, overrides: Partial<Action> = {}): Action => ({
  id: "act_001", kind: "prepare", title: "準備する", modality: "required",
  actor: { certainty: "unknown" }, inference: "explicit", status: "proposed",
  evidence: [{ source_id: "notice", text }], ...overrides,
});

async function verify(text: string, candidate: Action) {
  const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "notice", text });
  return verifyManifest({ schema_version: SCHEMA_VERSION, source: { id: doc.id, hash: doc.sourceHash }, actions: [candidate] }, doc);
}

describe("public verification rejects plausible but wrong notice actions", () => {
  it("rejects a date copied from an unrelated event", async () => {
    const evidence = "参加票を提出してください。";
    const { manifest, flags } = await verify("説明会は令和8年10月20日です。" + evidence, action(evidence, {
      kind: "submit", temporal: { type: "exact", date: "2026-10-20", raw_text: "10月20日" },
    }));
    expect(flags.actions?.[0]?.temporal_supported).toBe(false);
    expect(manifest.actions[0]?.status).toBe("proposed");
  });
  it("requires a weather condition in the action, even with a correct quote", async () => {
    const text = "雨天の場合は、タオルを持参してください。";
    const { manifest, flags } = await verify(text, action(text));
    expect(flags.actions?.[0]?.issues.some(i => i.code === "CONDITION_LOST")).toBe(true);
    expect(manifest.actions[0]?.status).toBe("proposed");
  });
  it("does not verify an active event backed by a cancellation", async () => {
    const text = "遠足は令和8年10月15日に予定していましたが中止となりました。";
    const { manifest, flags } = await verify(text, action(text, { kind: "event" }));
    expect(flags.actions?.[0]?.issues.some(i => i.code === "CANCELLATION_CONFLICT")).toBe(true);
    expect(manifest.actions[0]?.status).toBe("proposed");
  });
});
