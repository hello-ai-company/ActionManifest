import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InvalidDocumentError,
  MalformedAdapterPayloadError,
  MissingSourceIdError,
  MultipleDocumentsError,
  canonicalText,
} from "@actionmanifest/core";
import { mapXbergResultToCanonical } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(here, "../fixtures", name), "utf8"));
}

describe("mapXbergResultToCanonical — real-shape fixtures", () => {
  it("maps a single plain-text extraction result", () => {
    const doc = mapXbergResultToCanonical(loadFixture("xberg-notice-text.json"), {
      sourceId: "notice-single",
    });
    expect(doc.id).toBe("notice-single");
    expect(doc.text).toContain("秋の遠足");
    expect(doc.text).toContain("10月5日までに参加確認票");
    expect(doc.mediaType).toBe("text/plain");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.metadata?.adapter).toBe("xberg");
  });

  it("maps an element-based markdown result with sections and source references", () => {
    const doc = mapXbergResultToCanonical(loadFixture("xberg-notice-elements.json"), {
      sourceId: "notice-multi",
    });
    expect(doc.id).toBe("notice-multi");
    expect(doc.title).toBe("保護者向け行事案内");
    expect(doc.mediaType).toBe("text/markdown");
    expect(doc.metadata?.upstream_extraction_method).toBe("native");

    const byText = new Map(doc.chunks?.map((c) => [c.text, c]));
    // heading preservation: title/heading elements set section context
    expect(byText.get("保護者向け行事案内")?.section).toBe("保護者向け行事案内");
    expect(byText.get("遠足について")?.section).toBe("遠足について");
    expect(byText.get("令和8年10月15日に秋の遠足を実施します。")?.section).toBe("遠足について");
    expect(byText.get("参加を希望する方は、10月5日までに参加確認票を提出してください。")?.section).toBe("提出物");
    expect(byText.get("当日は弁当、水筒、タオルを持参してください。")?.section).toBe("持ち物");
    // source reference: Xberg element ids are provenance locators, not document identity
    expect(byText.get("雨天の場合は10月22日に延期します。")?.sourceReference).toMatch(/^elem-/);
  });

  it("omits pages when the upstream format is not page-addressable (no page-1 invention)", () => {
    const doc = mapXbergResultToCanonical(loadFixture("xberg-notice-elements.json"), {
      sourceId: "notice-multi",
    });
    expect(doc.pages).toBeUndefined();
    expect(doc.chunks?.every((c) => c.pageNumber === undefined)).toBe(true);
  });

  it("omits bbox even when coordinates exist (unknown coordinate system/page size)", () => {
    const fixture = loadFixture("xberg-notice-elements.json") as {
      results: [{ elements: { metadata: Record<string, unknown> }[] }];
    };
    // Simulate a payload where coordinates ARE present — they still must not
    // be mapped, because the coordinate system and page dimensions are unknown.
    fixture.results[0]!.elements[0]!.metadata["coordinates"] = { x0: 10, y0: 20, x1: 100, y1: 40 };
    const doc = mapXbergResultToCanonical(fixture, { sourceId: "notice-multi" });
    expect(doc.chunks?.every((c) => c.bbox === undefined)).toBe(true);
  });

  it("is deterministic: same payload → same hash", () => {
    const a = mapXbergResultToCanonical(loadFixture("xberg-notice-text.json"), { sourceId: "s" });
    const b = mapXbergResultToCanonical(loadFixture("xberg-notice-text.json"), { sourceId: "s" });
    expect(a.sourceHash).toBe(b.sourceHash);
    expect(canonicalText(a)).toBe(canonicalText(b));
  });

  it("keeps source identity caller-supplied and distinct from Xberg element ids", () => {
    const doc = mapXbergResultToCanonical(loadFixture("xberg-notice-elements.json"), {
      sourceId: "file:notice.md",
    });
    expect(doc.id).toBe("file:notice.md");
    for (const c of doc.chunks ?? []) {
      expect(c.sourceReference).not.toBe(doc.id);
    }
  });

  it("maps language when upstream provides detectedLanguages", () => {
    const fixture = loadFixture("xberg-notice-text.json") as {
      results: [{ detectedLanguages?: string[] }];
    };
    fixture.results[0]!.detectedLanguages = ["ja"];
    const doc = mapXbergResultToCanonical(fixture, { sourceId: "s" });
    expect(doc.language).toBe("ja");
  });

  it("preserves upstream counts under metadata", () => {
    const doc = mapXbergResultToCanonical(loadFixture("xberg-notice-text.json"), { sourceId: "s" });
    expect(doc.metadata?.upstream_counts).toEqual({ pages: 0, tables: 0, images: 0 });
  });
});

describe("mapXbergResultToCanonical — pages when present", () => {
  it("maps per-page content preserving page numbers", () => {
    const payload = {
      results: [
        {
          content: "ページ1の内容\nページ2の内容",
          mimeType: "application/pdf",
          pages: [
            { pageNumber: 1, content: "ページ1の内容", tables: [], imageIndices: [] },
            { pageNumber: 2, content: "ページ2の内容", tables: [], imageIndices: [] },
          ],
        },
      ],
      errors: [],
    };
    const doc = mapXbergResultToCanonical(payload, { sourceId: "pdf-1" });
    expect(doc.pages?.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(doc.pages?.[1]?.text).toBe("ページ2の内容");
    expect(doc.mediaType).toBe("application/pdf");
  });

  it("rejects malformed page numbers", () => {
    const payload = {
      results: [{ content: "x", pages: [{ pageNumber: 0, content: "x" }] }],
    };
    expect(() => mapXbergResultToCanonical(payload, { sourceId: "s" })).toThrowError(
      MalformedAdapterPayloadError,
    );
  });
});

describe("mapXbergResultToCanonical — failure semantics (fail closed)", () => {
  it("rejects multiple documents explicitly (never silently concatenates)", () => {
    const payload = {
      results: [
        { content: "doc A", mimeType: "text/plain" },
        { content: "doc B", mimeType: "text/plain" },
      ],
      errors: [],
    };
    expect(() => mapXbergResultToCanonical(payload, { sourceId: "s" })).toThrowError(
      MultipleDocumentsError,
    );
  });

  it("rejects empty results with upstream errors surfaced", () => {
    try {
      mapXbergResultToCanonical(
        { results: [], errors: [{ message: "unsupported format" }] },
        { sourceId: "s" },
      );
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidDocumentError);
      expect((e as InvalidDocumentError).code).toBe("INVALID_DOCUMENT");
      expect(JSON.stringify((e as InvalidDocumentError).details)).toContain("unsupported format");
    }
  });

  it("rejects empty results without errors", () => {
    expect(() => mapXbergResultToCanonical({ results: [] }, { sourceId: "s" })).toThrowError(
      InvalidDocumentError,
    );
  });

  it("rejects missing content and missing elements", () => {
    expect(() =>
      mapXbergResultToCanonical({ results: [{ mimeType: "text/plain" }] }, { sourceId: "s" }),
    ).toThrowError(InvalidDocumentError);
  });

  it("composes text from elements when content is missing", () => {
    const doc = mapXbergResultToCanonical(
      {
        results: [
          {
            mimeType: "text/markdown",
            elements: [
              { elementId: "e1", elementType: "narrative_text", text: "本文のみ", metadata: {} },
            ],
          },
        ],
      },
      { sourceId: "s" },
    );
    expect(doc.text).toBe("本文のみ");
    expect(doc.metadata?.warnings).toContain("content missing; text composed from elements");
  });

  it("rejects malformed payloads", () => {
    expect(() => mapXbergResultToCanonical("nope", { sourceId: "s" })).toThrowError(
      MalformedAdapterPayloadError,
    );
    expect(() => mapXbergResultToCanonical({ results: "not-array" }, { sourceId: "s" })).toThrowError(
      MalformedAdapterPayloadError,
    );
    expect(() =>
      mapXbergResultToCanonical({ results: [{ content: "x", elements: [{ text: "no id" }] }] }, { sourceId: "s" }),
    ).toThrowError(MalformedAdapterPayloadError);
  });

  it("requires caller-supplied source identity", () => {
    expect(() =>
      mapXbergResultToCanonical({ results: [{ content: "x" }] }, { sourceId: "" }),
    ).toThrowError(MissingSourceIdError);
  });
});
