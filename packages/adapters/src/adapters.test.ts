import { describe, expect, it } from "vitest";
import { DoclingAdapter, PlainTextAdapter, getAdapter, resolveAdapter } from "./index.js";
import { DocumentAdapterError, InvalidDocumentError } from "@actionmanifest/core";

describe("adapters", () => {
  it("plain text produces hashed canonical document", async () => {
    const doc = await new PlainTextAdapter().toCanonical({
      kind: "text",
      id: "n1",
      text: "hello",
    });
    expect(doc.text).toBe("hello");
    expect(doc.mediaType).toBe("text/plain");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(doc.pages?.[0]?.pageNumber).toBe(1);
  });

  it("plain text rejects empty content instead of returning an empty document", async () => {
    await expect(
      new PlainTextAdapter().toCanonical({ kind: "text", id: "empty", text: "" }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("docling fixture maps texts/pages (Phase 1 shorthand stays supported)", async () => {
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

  it("docling empty payload fails explicitly (no silent empty document)", async () => {
    await expect(
      new DoclingAdapter().toCanonical({
        kind: "docling-json",
        payload: { name: "empty" },
      }),
    ).rejects.toBeInstanceOf(InvalidDocumentError);
  });

  it("registry resolves adapters and rejects unknown ids", () => {
    expect(getAdapter("plain-text").id).toBe("plain-text");
    expect(getAdapter("docling").id).toBe("docling");
    expect(() => getAdapter("nope")).toThrowError(DocumentAdapterError);
    expect(resolveAdapter({ kind: "text", text: "x" }).id).toBe("plain-text");
    expect(resolveAdapter({ kind: "docling-json", payload: {} }).id).toBe("docling");
  });
});
