import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, sha256Hex, type ActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { verifyManifest, verificationPassed } from "./verify.js";

const adapter = new PlainTextAdapter();

async function doc(text: string, id = "t") {
  return adapter.toCanonical({ kind: "text", id, text });
}

function wrap(docId: string, hash: string | undefined, actions: ActionManifest["actions"]): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: docId, hash },
    actions,
  };
}

describe("verifier", () => {
  it("accepts evidence that appears in the source", async () => {
    const text = "令和8年10月15日に遠足を実施します。";
    const d = await doc(text, "ok");
    const manifest = wrap("ok", d.sourceHash, [
      {
        id: "act_001",
        kind: "event",
        title: "遠足",
        modality: "required",
        actor: { certainty: "unknown" },
        temporal: {
          type: "exact",
          date: "2026-10-15",
          raw_text: "令和8年10月15日",
          precision: "day",
        },
        evidence: [{ source_id: "ok", text: "令和8年10月15日に遠足を実施します。" }],
        inference: "explicit",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(verificationPassed(flags)).toBe(true);
  });

  it("rejects evidence quotes not in the source", async () => {
    const d = await doc("何もありません。", "x");
    const manifest = wrap("x", d.sourceHash, [
      {
        id: "act_001",
        kind: "submit",
        title: "invented",
        modality: "required",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "x", text: "明日までに提出してください。" }],
        inference: "inferred",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.evidence_supported).toBe(false);
    expect(flags.issues?.some((i) => i.code === "EVIDENCE_NOT_IN_SOURCE")).toBe(true);
  });

  it("rejects hallucinated exact dates from 「10月頃」", async () => {
    const text = "健康診断は10月頃の予定です。";
    const d = await doc(text, "approx");
    const manifest = wrap("approx", d.sourceHash, [
      {
        id: "act_001",
        kind: "event",
        title: "健康診断",
        modality: "unknown",
        actor: { certainty: "unknown" },
        temporal: {
          type: "exact",
          date: "2026-10-01",
          raw_text: "10月頃",
          precision: "day",
        },
        evidence: [{ source_id: "approx", text }],
        inference: "inferred",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.temporal_supported).toBe(false);
  });

  it("flags negation conflict for blanket required submit", async () => {
    const text = "前回すでに参加確認票を提出した方は、再提出する必要はありません。";
    const d = await doc(text, "neg");
    const manifest = wrap("neg", d.sourceHash, [
      {
        id: "act_001",
        kind: "submit",
        title: "参加確認票を提出する",
        modality: "required",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "neg", text }],
        inference: "inferred",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.negation_conflict).toBe(true);
  });

  it("rejects source hash mismatch", async () => {
    const d = await doc("hello world", "h");
    const manifest = wrap("h", sha256Hex("other"), [
      {
        id: "act_001",
        kind: "read",
        title: "read",
        modality: "unknown",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "h", text: "hello world" }],
        inference: "explicit",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.source_hash_matched).toBe(false);
  });

  it("rejects invalid page references", async () => {
    const d = await doc("page one", "p");
    const manifest = wrap("p", d.sourceHash, [
      {
        id: "act_001",
        kind: "read",
        title: "read",
        modality: "unknown",
        actor: { certainty: "unknown" },
        evidence: [{ source_id: "p", text: "page one", page: 9 }],
        inference: "explicit",
        status: "proposed",
      },
    ]);
    const { flags } = verifyManifest(manifest, d);
    expect(flags.page_refs_valid).toBe(false);
  });
});
