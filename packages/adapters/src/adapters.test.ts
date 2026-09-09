import { describe, expect, it } from "vitest";
import { DoclingAdapter, PlainTextAdapter } from "./index.js";
import { NotImplementedError } from "@actionmanifest/core";

describe("adapters", () => {
  it("plain text produces hashed canonical document", async () => {
    const doc = await new PlainTextAdapter().toCanonical({
      kind: "text",
      id: "n1",
      text: "hello",
    });
    expect(doc.text).toBe("hello");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.pages?.[0]?.pageNumber).toBe(1);
  });

  it("docling fixture maps texts/pages", async () => {
    const doc = await new DoclingAdapter().toCanonical({
      kind: "docling-json",
      id: "d1",
      payload: {
        name: "fixture",
        pages: [{ page_no: 1, text: "From Docling fixture." }],
        texts: [{ text: "From Docling fixture.", page_no: 1, self_ref: "#/texts/0" }],
      },
    });
    expect(doc.text).toContain("From Docling fixture.");
    expect(doc.metadata?.adapter).toBe("docling");
  });

  it("docling without payload is not implemented (no live OCR)", async () => {
    await expect(
      new DoclingAdapter().toCanonical({
        kind: "docling-json",
        payload: { name: "empty" },
      }),
    ).rejects.toBeInstanceOf(NotImplementedError);
  });
});
