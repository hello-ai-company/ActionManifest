import { describe, expect, it, vi } from "vitest";
import { analyzeMatoeRequest, matoeAnalysisFailure, readMatoeStdin } from "./matoe-analysis.js";

describe("bounded offline Matoe analysis input", () => {
  it.each([null, [], {}, { sourceId: "s", ocrText: " " }, { sourceId: "s", ocrText: "text", provider: "openai" }, { sourceId: "s", ocrText: "\ud800" }])(
    "refuses invalid/extra input fields without exposing input in errors", async input => {
      await expect(analyzeMatoeRequest(input)).rejects.toMatchObject({ code: "MATOE_REQUEST_INVALID" });
    },
  );

  it("enforces scalar and transport budgets before extraction", async () => {
    await expect(analyzeMatoeRequest({ sourceId: "s", ocrText: "a".repeat(60_001) })).rejects.toMatchObject({ code: "MATOE_INPUT_TOO_LARGE" });
    async function* input() { yield Buffer.alloc(1_048_577, 32); }
    await expect(readMatoeStdin(input())).rejects.toMatchObject({ code: "MATOE_INPUT_TOO_LARGE" });
  });

  it("requires valid UTF-8 and JSON including sequences split across stream chunks", async () => {
    async function* bad() { yield Buffer.from([0xc3, 0x28]); }
    await expect(readMatoeStdin(bad())).rejects.toMatchObject({ code: "MATOE_REQUEST_INVALID" });
    const request = { sourceId: "s", ocrText: "合成文 😀" };
    const bytes = Buffer.from(JSON.stringify(request));
    async function* split() { for (const byte of bytes) yield Buffer.from([byte]); }
    expect(await readMatoeStdin(split())).toEqual(request);
  });

  it("preserves exact text hashing and omits invented page geometry", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("NETWORK_MUST_NOT_BE_USED"));
    try {
      const text = "[ページ 2]\n2026年10月15日までに参加票を提出してください。\n";
      const manifest = await analyzeMatoeRequest({ sourceId: "s", ocrText: text });
      expect(manifest.schema_version).toBe("0.2.0");
      expect(manifest.actions.length).toBeGreaterThan(0);
      expect(manifest.actions.every(action => action.evidence.every(evidence => evidence.page === undefined && evidence.bbox === undefined))).toBe(true);
      expect(manifest.receipt?.extraction.provider).toBe("deterministic");
      expect(spy).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });

  it("sanitizes unexpected exceptions and returns a fixed nonsecret error", () => {
    expect(matoeAnalysisFailure(new Error("SYNTHETIC_SECRET_MARKER"))).toEqual({ error: { code: "MATOE_PIPELINE_FAILED", message: "Analysis pipeline failed" } });
  });

  it("binds the result to the original canonical input when the caller mutates a pending request", async () => {
    const request = { sourceId: "synthetic-original", ocrText: "2026年10月15日までに参加票を提出してください。\n" };
    const original = await analyzeMatoeRequest(request);
    const mutable = structuredClone(request);
    const pending = analyzeMatoeRequest(mutable);
    mutable.sourceId = "synthetic-replacement";
    mutable.ocrText = "2026年12月24日までに別の票を提出してください。\n";
    const result = await pending;
    expect(result.source).toEqual(original.source);
    expect(result.actions).toEqual(original.actions);
  });
});
