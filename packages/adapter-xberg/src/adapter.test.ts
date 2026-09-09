import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { UnsupportedInputError } from "@actionmanifest/core";
import { XbergAdapter } from "./index.js";

const here = dirname(fileURLToPath(import.meta.url));
const adapter = new XbergAdapter();

describe("XbergAdapter (contract surface, no runtime)", () => {
  it("maps a pre-computed Xberg result (xberg-result)", async () => {
    const payload = JSON.parse(
      readFileSync(join(here, "../fixtures/xberg-notice-text.json"), "utf8"),
    );
    const doc = await adapter.toCanonical({
      kind: "xberg-result",
      sourceId: "notice-1",
      payload,
    });
    expect(doc.id).toBe("notice-1");
    expect(doc.text).toContain("秋の遠足");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("canHandle recognizes xberg inputs and rejects others", () => {
    expect(adapter.canHandle({ kind: "xberg-result", sourceId: "s", payload: {} })).toBe(true);
    expect(adapter.canHandle({ kind: "xberg-uri", sourceId: "s", uri: "file.pdf" })).toBe(true);
    expect(
      adapter.canHandle({ kind: "xberg-bytes", sourceId: "s", bytes: new Uint8Array() }),
    ).toBe(true);
    expect(adapter.canHandle({ kind: "text", text: "x" })).toBe(false);
    expect(adapter.canHandle({ kind: "docling-json", payload: {} })).toBe(false);
  });

  it("rejects non-xberg inputs", async () => {
    await expect(adapter.toCanonical({ kind: "text", text: "x" })).rejects.toBeInstanceOf(
      UnsupportedInputError,
    );
  });

  it("never fetches remote URLs without explicit allowRemote", async () => {
    await expect(
      adapter.toCanonical({ kind: "xberg-uri", sourceId: "s", uri: "https://example.com/doc.pdf" }),
    ).rejects.toBeInstanceOf(UnsupportedInputError);
    await expect(
      adapter.toCanonical({ kind: "xberg-uri", sourceId: "s", uri: "https://example.com/doc.pdf" }),
    ).rejects.toThrowError(/allowRemote/);
  });
});
