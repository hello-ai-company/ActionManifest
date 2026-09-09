import { describe, expect, it } from "vitest";
import {
  InvalidDocumentError,
  assertCanonicalDocument,
  checkCanonicalDocument,
  isCanonicalBoundingBox,
  locateEvidence,
  type CanonicalDocument,
} from "./index.js";

function baseDoc(): CanonicalDocument {
  return {
    id: "doc-1",
    text: "page one text\npage two text",
    pages: [
      { pageNumber: 1, text: "page one text" },
      { pageNumber: 2, text: "page two text" },
    ],
  };
}

describe("checkCanonicalDocument", () => {
  it("accepts a consistent document", () => {
    expect(checkCanonicalDocument(baseDoc()).filter((i) => i.severity === "error")).toHaveLength(0);
  });

  it("flags an empty document", () => {
    const issues = checkCanonicalDocument({ id: "empty" });
    expect(issues.some((i) => i.code === "EMPTY_DOCUMENT" && i.severity === "error")).toBe(true);
  });

  it("flags duplicate page numbers", () => {
    const doc = baseDoc();
    doc.pages = [
      { pageNumber: 1, text: "a" },
      { pageNumber: 1, text: "b" },
    ];
    const issues = checkCanonicalDocument(doc);
    expect(issues.some((i) => i.code === "DUPLICATE_PAGE_NUMBER")).toBe(true);
  });

  it("flags invalid bbox and accepts normalized bbox", () => {
    const doc = baseDoc();
    doc.chunks = [
      { text: "ok", pageNumber: 1, bbox: { x: 0.1, y: 0.2, width: 0.3, height: 0.1 } },
      { text: "bad", pageNumber: 1, bbox: { x: 0.9, y: 0, width: 0.3, height: 0.1 } },
      { text: "neg", pageNumber: 1, bbox: { x: -0.1, y: 0, width: 0.1, height: 0.1 } },
    ];
    const issues = checkCanonicalDocument(doc);
    const bboxIssues = issues.filter((i) => i.code === "INVALID_BBOX");
    expect(bboxIssues).toHaveLength(2);
    expect(bboxIssues.map((i) => i.path).sort()).toEqual(["chunks[1].bbox", "chunks[2].bbox"]);
  });

  it("flags malformed source hash shape", () => {
    const doc = { ...baseDoc(), sourceHash: "not-a-hash" };
    expect(checkCanonicalDocument(doc).some((i) => i.code === "INVALID_SOURCE_HASH")).toBe(true);
    const ok = { ...baseDoc(), sourceHash: "a".repeat(64) };
    expect(checkCanonicalDocument(ok).some((i) => i.code === "INVALID_SOURCE_HASH")).toBe(false);
  });

  it("flags chunk page references to unknown pages", () => {
    const doc = baseDoc();
    doc.chunks = [{ text: "orphan", pageNumber: 9 }];
    expect(checkCanonicalDocument(doc).some((i) => i.code === "CHUNK_PAGE_UNKNOWN")).toBe(true);
  });

  it("warns (does not error) when document text differs from page text", () => {
    const doc = baseDoc();
    doc.text = "completely different text";
    const issues = checkCanonicalDocument(doc);
    const mismatch = issues.find((i) => i.code === "TEXT_PAGES_MISMATCH");
    expect(mismatch?.severity).toBe("warning");
    expect(issues.filter((i) => i.severity === "error")).toHaveLength(0);
  });
});

describe("assertCanonicalDocument", () => {
  it("returns the document when valid", () => {
    expect(assertCanonicalDocument(baseDoc()).id).toBe("doc-1");
  });

  it("throws InvalidDocumentError with issue details when invalid", () => {
    try {
      assertCanonicalDocument({ id: "x" });
      expect.unreachable("must throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidDocumentError);
      const err = e as InvalidDocumentError;
      expect(err.code).toBe("INVALID_DOCUMENT");
      const details = err.details as { issues: { code: string }[] };
      expect(details.issues.some((i) => i.code === "EMPTY_DOCUMENT")).toBe(true);
    }
  });

  it("still enforces the JSON schema (id required)", () => {
    expect(() => assertCanonicalDocument({ text: "hello" })).toThrowError();
  });

  it("does not throw on warning-only documents", () => {
    const doc = baseDoc();
    doc.text = "different";
    expect(assertCanonicalDocument(doc).id).toBe("doc-1");
  });
});

describe("isCanonicalBoundingBox", () => {
  it("accepts normalized boxes and rejects absolute/overflowing ones", () => {
    expect(isCanonicalBoundingBox({ x: 0, y: 0, width: 1, height: 1 })).toBe(true);
    expect(isCanonicalBoundingBox({ x: 72, y: 72, width: 468, height: 36 })).toBe(false);
    expect(isCanonicalBoundingBox({ x: 0.5, y: 0.5, width: Number.NaN, height: 0.1 })).toBe(false);
    expect(isCanonicalBoundingBox({ x: 0.2, y: 0.2, width: -0.1, height: 0.1 })).toBe(false);
  });
});

describe("locateEvidence", () => {
  it("finds chunk-level page, bbox, section and sourceReference", () => {
    const doc: CanonicalDocument = {
      id: "d",
      text: "提出してください。",
      pages: [{ pageNumber: 2, text: "提出してください。" }],
      chunks: [
        {
          text: "10月5日までに参加確認票を提出してください。",
          pageNumber: 2,
          bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
          section: "提出物",
          sourceReference: "#/texts/4",
        },
      ],
    };
    const found = locateEvidence(doc, "参加確認票を提出してください");
    expect(found).toEqual({
      page: 2,
      bbox: { x: 0.1, y: 0.1, width: 0.5, height: 0.05 },
      section: "提出物",
      sourceReference: "#/texts/4",
    });
  });

  it("falls back to page-level location when no chunk matches", () => {
    const doc: CanonicalDocument = {
      id: "d",
      pages: [
        { pageNumber: 1, text: "雨の話" },
        { pageNumber: 2, text: "晴れの話" },
      ],
    };
    expect(locateEvidence(doc, "晴れの話")).toEqual({ page: 2 });
  });

  it("returns undefined instead of inventing a location", () => {
    expect(locateEvidence(baseDoc(), "存在しない文")).toBeUndefined();
  });
});
