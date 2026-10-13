import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { explainCandidate, explanationFailure } from "./explain.js";
const base = new URL("../../../packages/consumer/fixtures/matoe-v02/", import.meta.url);
const golden = () => JSON.parse(readFileSync(new URL("golden.json", base), "utf8"));
const source = readFileSync(new URL("source.txt", base), "utf8");

describe("offline explanation entry", () => {
  it("reverifies using exact source and ignores provider configuration without calling fetch", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("MUST_NOT_CALL"));
    try {
      const report = await explainCandidate(golden(), source);
      expect(report.counts.ready).toBe(4); expect(report.authority.execution_allowed).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    } finally { fetch.mockRestore(); }
  });
  it("does not trust a forged receipt when evidence is unsupported", async () => {
    const input = golden(); input.actions[0].evidence[0].text = "FABRICATED_PRIVATE_QUOTE";
    const report = await explainCandidate(input, source);
    expect(report.actions[0]!.verification).toBe("blocked");
    expect(JSON.stringify(report)).not.toContain("FABRICATED_PRIVATE_QUOTE");
  });
  it("refuses altered exact-source bytes", async () => {
    await expect(explainCandidate(golden(), source + "\n")).rejects.toMatchObject({ code: "AGENT_SOURCE_MISMATCH" });
  });
  it.each(["accepted", "rejected", "exported"])("does not import lifecycle %s into the candidate verifier", async status => {
    const input = golden(); input.actions[0].status = status;
    await expect(explainCandidate(input, source)).rejects.toMatchObject({ code: "AGENT_LIFECYCLE_INVALID" });
  });
  it("applies request depth guards before recursive schema validation", async () => {
    const input = golden(); let nested: unknown = null;
    for (let i = 0; i < 30; i++) nested = { nested };
    input.extra = nested;
    await expect(explainCandidate(input, source)).rejects.toMatchObject({ code: "AGENT_INPUT_TOO_LARGE" });
  });
  it("reports a fixed nonsecret error and includes quotes only when selected", async () => {
    expect(explanationFailure().code).toBe("EXPLANATION_INPUT_INVALID");
    const report = await explainCandidate(golden(), source, true);
    expect(report.actions[0]!.evidence).toEqual(golden().actions[0].evidence);
  });
});
