import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  InvalidBoundingBoxError,
  InvalidDocumentError,
  InvalidPageError,
  MalformedAdapterPayloadError,
  MissingSourceIdError,
  NotImplementedError,
  UnsupportedInputError,
} from "@actionmanifest/core";
import { DoclingAdapter, mapDoclingDocument, mapDoclingFixture } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(here, "../../../examples/docling-school-notice.json");

function loadSchoolNotice(): Record<string, unknown> {
  return JSON.parse(readFileSync(fixturePath, "utf8")) as Record<string, unknown>;
}

const adapter = new DoclingAdapter();

describe("DoclingAdapter — contract (valid inputs)", () => {
  it("maps a valid single-page document", async () => {
    const doc = await adapter.toCanonical({
      kind: "docling-json",
      payload: {
        name: "single",
        texts: [
          {
            text: "Only page text.",
            label: "paragraph",
            prov: [{ page_no: 1, bbox: { l: 72, t: 72, r: 288, b: 96, coord_origin: "TOPLEFT" } }],
          },
        ],
        pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
      },
    });
    expect(doc.id).toBe("single");
    expect(doc.pages).toHaveLength(1);
    expect(doc.pages?.[0]?.text).toBe("Only page text.");
    expect(doc.chunks?.[0]?.pageNumber).toBe(1);
  });

  it("maps the synthetic two-page school notice fixture", async () => {
    const doc = await adapter.toCanonical({ kind: "docling-json", payload: loadSchoolNotice() });
    expect(doc.id).toBe("synthetic-autumn-excursion-notice");
    expect(doc.mediaType).toBe("application/pdf");
    expect(doc.pages?.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(doc.pages?.[0]?.text).toContain("秋の遠足");
    expect(doc.pages?.[1]?.text).toContain("参加確認票");
    expect(doc.text).toContain("保護者向け行事案内");
    expect(doc.text).toContain("持参してください");
  });

  it("preserves page numbers on every chunk", async () => {
    const doc = await adapter.toCanonical({ kind: "docling-json", payload: loadSchoolNotice() });
    const byText = new Map(doc.chunks?.map((c) => [c.text, c]));
    expect(byText.get("令和8年10月15日に秋の遠足を実施します。")?.pageNumber).toBe(1);
    expect(byText.get("参加を希望する方は、10月5日までに参加確認票を提出してください。")?.pageNumber).toBe(2);
    expect(byText.get("当日は弁当、水筒、タオルを持参してください。")?.pageNumber).toBe(2);
  });

  it("preserves headings as section context for following chunks", async () => {
    const doc = await adapter.toCanonical({ kind: "docling-json", payload: loadSchoolNotice() });
    const byText = new Map(doc.chunks?.map((c) => [c.text, c]));
    expect(byText.get("保護者向け行事案内")?.section).toBe("保護者向け行事案内");
    expect(byText.get("提出物と持ち物")?.section).toBe("提出物と持ち物");
    expect(byText.get("参加を希望する方は、10月5日までに参加確認票を提出してください。")?.section).toBe(
      "提出物と持ち物",
    );
    expect(byText.get("令和8年10月15日に秋の遠足を実施します。")?.section).toBe("保護者向け行事案内");
  });

  it("normalizes bboxes to the canonical 0..1 page-relative convention", async () => {
    const doc = await adapter.toCanonical({ kind: "docling-json", payload: loadSchoolNotice() });
    const submit = doc.chunks?.find((c) => c.text.includes("参加確認票"));
    expect(submit?.bbox).toBeDefined();
    const bbox = submit!.bbox!;
    expect(bbox.x).toBeCloseTo(72 / 612, 6);
    expect(bbox.y).toBeCloseTo(128 / 792, 6);
    expect(bbox.width).toBeCloseTo((540 - 72) / 612, 6);
    expect(bbox.height).toBeCloseTo((152 - 128) / 792, 6);
    for (const chunk of doc.chunks ?? []) {
      if (!chunk.bbox) continue;
      expect(chunk.bbox.x).toBeGreaterThanOrEqual(0);
      expect(chunk.bbox.y).toBeGreaterThanOrEqual(0);
      expect(chunk.bbox.x + chunk.bbox.width).toBeLessThanOrEqual(1 + 1e-9);
      expect(chunk.bbox.y + chunk.bbox.height).toBeLessThanOrEqual(1 + 1e-9);
    }
  });

  it("converts BOTTOMLEFT origins correctly", () => {
    const doc = mapDoclingDocument({
      name: "bottomleft",
      texts: [
        {
          text: "bottom-left origin",
          prov: [{ page_no: 1, bbox: { l: 72, t: 720, r: 288, b: 696, coord_origin: "BOTTOMLEFT" } }],
        },
      ],
      pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
    });
    // BOTTOMLEFT: t=720 is the top edge measured from the bottom → y = (792-720)/792
    expect(doc.chunks?.[0]?.bbox?.y).toBeCloseTo((792 - 720) / 792, 6);
    expect(doc.chunks?.[0]?.bbox?.height).toBeCloseTo((720 - 696) / 792, 6);
  });

  it("keeps source identity stable and the hash deterministic", async () => {
    const payload = loadSchoolNotice();
    const a = await adapter.toCanonical({ kind: "docling-json", payload });
    const b = await adapter.toCanonical({ kind: "docling-json", payload: loadSchoolNotice() });
    expect(a.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.sourceHash).toBe(b.sourceHash);
    const overridden = await adapter.toCanonical({
      kind: "docling-json",
      id: "external-id",
      payload,
    });
    expect(overridden.id).toBe("external-id");
    expect(overridden.sourceHash).toBe(a.sourceHash);
    expect(overridden.metadata?.upstream_binary_hash).toBe(1234567890);
  });

  it("keeps the Phase 1 fixture shorthand working via mapDoclingFixture", () => {
    const doc = mapDoclingFixture(
      { name: "legacy", pages: [{ page_no: 1, text: "legacy text" }] },
      undefined,
      "Legacy title",
    );
    expect(doc.id).toBe("legacy");
    expect(doc.title).toBe("Legacy title");
    expect(doc.pages?.[0]?.text).toBe("legacy text");
  });
});

describe("DoclingAdapter — failure semantics (no silent fallback)", () => {
  it("rejects non-object payloads", async () => {
    await expect(
      adapter.toCanonical({ kind: "docling-json", payload: "not-an-object" }),
    ).rejects.toBeInstanceOf(MalformedAdapterPayloadError);
  });

  it("rejects binary payloads as not implemented (live conversion out of scope)", async () => {
    await expect(
      adapter.toCanonical({ kind: "docling-json", payload: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });

  it("rejects the wrong input kind", async () => {
    await expect(
      adapter.toCanonical({ kind: "text", text: "hello" }),
    ).rejects.toBeInstanceOf(UnsupportedInputError);
  });

  it("requires a source identity (id or payload name)", async () => {
    await expect(
      adapter.toCanonical({
        kind: "docling-json",
        payload: { texts: [{ text: "x", prov: [{ page_no: 1 }] }] },
      }),
    ).rejects.toBeInstanceOf(MissingSourceIdError);
  });

  it("rejects an empty payload as INVALID_DOCUMENT, never an empty CanonicalDocument", async () => {
    await expect(
      adapter.toCanonical({ kind: "docling-json", payload: { name: "empty" } }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
    await expect(
      adapter.toCanonical({ kind: "docling-json", payload: { name: "empty2", texts: [] } }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("rejects malformed page numbers", () => {
    expect(() =>
      mapDoclingDocument({
        name: "bad-page",
        texts: [{ text: "x", prov: [{ page_no: 0 }] }],
      }),
    ).toThrowError(InvalidPageError);
    expect(() =>
      mapDoclingDocument({
        name: "bad-page-2",
        pages: { "1": { page_no: "one" } },
        texts: [{ text: "x", prov: [{ page_no: 1 }] }],
      }),
    ).toThrowError(InvalidPageError);
  });

  it("rejects provenance that references an undeclared page", () => {
    expect(() =>
      mapDoclingDocument({
        name: "unknown-page",
        texts: [{ text: "x", prov: [{ page_no: 7 }] }],
        pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
      }),
    ).toThrowError(InvalidPageError);
  });

  it("rejects duplicate page numbers", () => {
    expect(() =>
      mapDoclingDocument({
        name: "dup-pages",
        pages: [
          { page_no: 1, text: "a" },
          { page_no: 1, text: "b" },
        ],
      }),
    ).toThrowError(InvalidDocumentError);
  });

  it("rejects malformed bboxes (non-numeric, inverted)", () => {
    expect(() =>
      mapDoclingDocument({
        name: "bbox-nan",
        texts: [{ text: "x", prov: [{ page_no: 1, bbox: { l: "a", t: 0, r: 1, b: 1, coord_origin: "TOPLEFT" } }] }],
        pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
      }),
    ).toThrowError(InvalidBoundingBoxError);
    expect(() =>
      mapDoclingDocument({
        name: "bbox-inverted",
        texts: [{ text: "x", prov: [{ page_no: 1, bbox: { l: 400, t: 0, r: 100, b: 1, coord_origin: "TOPLEFT" } }] }],
        pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
      }),
    ).toThrowError(InvalidBoundingBoxError);
  });

  it("omits bbox when the coordinate origin is unknown (never guesses 0..1)", () => {
    const doc = mapDoclingDocument({
      name: "unknown-origin",
      texts: [{ text: "x", prov: [{ page_no: 1, bbox: { l: 1, t: 2, r: 3, b: 4, coord_origin: "CENTER" } }] }],
      pages: { "1": { page_no: 1, size: { width: 612, height: 792 } } },
    });
    expect(doc.chunks?.[0]?.bbox).toBeUndefined();
    expect(doc.metadata?.warnings).toContain("bbox omitted: unknown coord_origin");
  });

  it("omits bbox when the page size is unknown (never guesses 0..1)", () => {
    const doc = mapDoclingDocument({
      name: "no-page-size",
      texts: [{ text: "x", prov: [{ page_no: 1, bbox: { l: 72, t: 72, r: 288, b: 96, coord_origin: "TOPLEFT" } }] }],
      pages: { "1": { page_no: 1 } },
    });
    expect(doc.chunks?.[0]?.bbox).toBeUndefined();
    expect(doc.metadata?.warnings).toContain("bbox omitted: page size unknown");
  });

  it("skips text items without text but fails when nothing remains", () => {
    const doc = mapDoclingDocument({
      name: "some-empty",
      texts: [
        { label: "paragraph" },
        { text: "real content", prov: [{ page_no: 1 }] },
      ],
      pages: { "1": { page_no: 1 } },
    });
    expect(doc.text).toBe("real content");
    expect(() =>
      mapDoclingDocument({ name: "all-empty", texts: [{ label: "paragraph" }] }),
    ).toThrowError(InvalidDocumentError);
  });
});
