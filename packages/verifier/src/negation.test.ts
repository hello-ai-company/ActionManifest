import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, type Action, type ActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { verifyManifest } from "./verify.js";

const adapter = new PlainTextAdapter();
async function doc(text: string, id = "t") {
  return adapter.toCanonical({ kind: "text", id, text });
}
function wrap(id: string, hash: string | undefined, actions: Action[]): ActionManifest {
  return { schema_version: SCHEMA_VERSION, source: { id, hash }, actions };
}

describe("Phase 1.1 — negation & exemption semantics (per action)", () => {
  it("required submit WITH an exemption condition is not a negation conflict", async () => {
    const text =
      "参加を希望する方は参加確認票を提出してください。前回すでに参加確認票を提出した方は、再提出する必要はありません。";
    const d = await doc(text, "exempt");
    const manifest = wrap("exempt", d.sourceHash, [
      {
        id: "act_001",
        kind: "submit",
        title: "参加確認票を提出する",
        object: "参加確認票",
        modality: "required",
        actor: { certainty: "unknown" },
        evidence: [
          { source_id: "exempt", text: "参加を希望する方は参加確認票を提出してください。" },
          { source_id: "exempt", text: "前回すでに参加確認票を提出した方は、再提出する必要はありません。" },
        ],
        conditions: ["参加を希望する", "前回すでに提出した方は再提出不要"],
        inference: "explicit",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    const r = flags.actions![0]!;
    expect(r.negation_conflict).toBe(false);
    expect(r.passed).toBe(true);
  });

  it("blanket required submit over a negation WITHOUT exemption is a conflict", async () => {
    const text = "前回すでに参加確認票を提出した方は、再提出する必要はありません。";
    const d = await doc(text, "blanket");
    const manifest = wrap("blanket", d.sourceHash, [
      {
        id: "act_001",
        kind: "submit",
        title: "参加確認票を提出する",
        modality: "required",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "blanket", text }],
        inference: "inferred",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.actions![0]!.negation_conflict).toBe(true);
    expect(flags.actions![0]!.passed).toBe(false);
  });

  it("prohibited modality over 提出不要 is supported (not a conflict)", async () => {
    const text = "変更届は提出不要です。";
    const d = await doc(text, "prohibit");
    const manifest = wrap("prohibit", d.sourceHash, [
      {
        id: "act_001",
        kind: "submit",
        title: "変更届は提出不要",
        object: "変更届",
        modality: "prohibited",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "prohibit", text }],
        inference: "explicit",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    const r = flags.actions![0]!;
    expect(r.modality_supported).toBe(true);
    expect(r.negation_conflict).toBe(false);
    expect(r.passed).toBe(true);
  });
});
