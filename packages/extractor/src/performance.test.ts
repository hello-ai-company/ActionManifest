import { beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@actionmanifest/core";
import { extractDeterministically } from "./deterministic.js";

vi.mock("@actionmanifest/core", async importOriginal => {
  const actual = await importOriginal<typeof import("@actionmanifest/core")>();
  return { ...actual, locateEvidence: vi.fn(actual.locateEvidence) };
});
beforeEach(() => vi.clearAllMocks());

describe("heading lookup work", () => {
  it("does not scan unstructured pages for every narrative sentence", () => {
    const actionText = "2026年10月15日までに参加票を提出してください。";
    const text = actionText + "\n" + "資料の補足。".repeat(500);
    const doc = core.ensureSourceHash({ id: "long", text, pages: [{ pageNumber: 1, text, chunks: [{ text, pageNumber: 1 }] }] });
    const actions = extractDeterministically(doc);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.evidence[0]).toMatchObject({ text: actionText, page: 1 });
    expect(core.locateEvidence).toHaveBeenCalledTimes(1); // the actual Action's locator only
  });

  it.each(["page-chunks", "document-chunks"])("still recognizes headings from %s", location => {
    const heading = "運動会のお知らせ";
    const instruction = "2026年10月15日までに参加票を提出してください。";
    const chunks = [{ text: heading, section: heading, pageNumber: 1 }, { text: instruction, pageNumber: 1 }];
    const doc = core.ensureSourceHash({ id: "structured", text: heading + "\n" + instruction,
      ...(location === "page-chunks" ? { pages: [{ pageNumber: 1, text: heading + "\n" + instruction, chunks }] } : { chunks }),
    });
    const actions = extractDeterministically(doc);
    expect(actions).toHaveLength(1);
    expect(actions[0]?.kind).toBe("submit");
    expect(core.locateEvidence).toHaveBeenCalledTimes(3); // both heading checks + Action Evidence
  });
});
