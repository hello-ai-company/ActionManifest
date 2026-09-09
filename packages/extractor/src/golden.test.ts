import { describe, expect, it } from "vitest";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { extractDeterministically } from "./deterministic.js";
import { ActionExtractor } from "./extractor.js";
import { MockProvider } from "./mock.js";
import { MalformedLlmOutputError } from "@actionmanifest/core";

const GOLDEN = `令和8年10月15日に秋の遠足を実施します。
参加を希望する方は、10月5日までに参加確認票を提出してください。
当日は弁当、水筒、タオルを持参してください。
雨天の場合は10月22日に延期します。
前回すでに参加確認票を提出した方は、再提出する必要はありません。
`;

describe("golden fixture extraction", () => {
  it("extracts event, conditional submit, prepare, rain alternative, and exemption", async () => {
    const doc = await new PlainTextAdapter().toCanonical({
      kind: "text",
      id: "school-golden-excursion",
      text: GOLDEN,
    });
    const actions = extractDeterministically(doc);

    const event = actions.find((a) => a.kind === "event");
    expect(event?.temporal?.date).toBe("2026-10-15");
    expect(event?.temporal?.alternatives?.some((t) => t.date === "2026-10-22" && t.condition === "雨天")).toBe(
      true,
    );

    const submit = actions.find((a) => a.kind === "submit");
    expect(submit).toBeTruthy();
    expect(submit?.temporal?.date).toBe("2026-10-05");
    expect(submit?.conditions?.some((c) => /希望/.test(c))).toBe(true);
    expect(submit?.conditions?.some((c) => /再提出/.test(c))).toBe(true);
    expect(submit?.evidence.some((e) => /再提出する必要はありません/.test(e.text))).toBe(true);

    const blanket = actions.filter(
      (a) =>
        a.kind === "submit" &&
        a.modality === "required" &&
        !(a.conditions ?? []).some((c) => /希望|再提出|提出した方/.test(c)),
    );
    expect(blanket).toHaveLength(0);

    const prepare = actions.find((a) => a.kind === "prepare");
    expect(prepare?.title).toMatch(/弁当/);
    expect(actions.every((a) => a.evidence.length > 0)).toBe(true);
  });

  it("rejects malformed LLM JSON instead of silent fallback", async () => {
    const doc = await new PlainTextAdapter().toCanonical({
      kind: "text",
      id: "x",
      text: "hello",
    });
    const extractor = new ActionExtractor(new MockProvider(() => "not-json"));
    await expect(extractor.extract(doc)).rejects.toBeInstanceOf(MalformedLlmOutputError);
  });

  it("rejects LLM output missing actions array", async () => {
    const doc = await new PlainTextAdapter().toCanonical({
      kind: "text",
      id: "x",
      text: "hello",
    });
    const extractor = new ActionExtractor(new MockProvider(() => JSON.stringify({ nope: true })));
    await expect(extractor.extract(doc)).rejects.toBeInstanceOf(MalformedLlmOutputError);
  });
});
