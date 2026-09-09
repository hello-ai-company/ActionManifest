import { describe, expect, it } from "vitest";
import {
  ensureSourceHash,
  type CanonicalDocument,
} from "@actionmanifest/core";
import {
  DoclingAdapter,
  PlainTextAdapter,
  resolveAdapter,
  type DocumentAdapter,
} from "./index.js";

/**
 * Parser independence requires adapter extensibility WITHOUT editing the
 * central package: a third-party adapter defines its OWN input type and
 * implements DocumentAdapter<ItsInput>. The central AdapterInput union stays
 * limited to the built-in reference adapters (plain text, Docling).
 */

// A hypothetical third-party Marker adapter — defined entirely outside the
// central adapters package's input union.
interface MarkerInput {
  kind: "marker-json";
  sourceId: string;
  payload: unknown;
}

class ExampleMarkerAdapter implements DocumentAdapter<MarkerInput> {
  readonly id = "marker-example";

  canHandle(input: MarkerInput): boolean {
    return input.kind === "marker-json";
  }

  async toCanonical(input: MarkerInput): Promise<CanonicalDocument> {
    const text =
      typeof input.payload === "object" &&
      input.payload !== null &&
      "text" in input.payload &&
      typeof (input.payload as { text: unknown }).text === "string"
        ? (input.payload as { text: string }).text
        : "";
    return ensureSourceHash({ id: input.sourceId, text });
  }
}

describe("DocumentAdapter — generic third-party extensibility", () => {
  it("a custom input type works without touching the central AdapterInput union", async () => {
    const adapter: DocumentAdapter<MarkerInput> = new ExampleMarkerAdapter();
    const input: MarkerInput = { kind: "marker-json", sourceId: "m1", payload: { text: "hello" } };
    expect(adapter.canHandle(input)).toBe(true);
    const doc = await adapter.toCanonical(input);
    expect(doc.id).toBe("m1");
    expect(doc.text).toBe("hello");
    expect(doc.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("built-in adapters still satisfy the default (built-in) contract", () => {
    const plain: DocumentAdapter = new PlainTextAdapter();
    const docling: DocumentAdapter = new DoclingAdapter();
    expect(plain.id).toBe("plain-text");
    expect(docling.id).toBe("docling");
    // The built-in registry keeps working over the built-in union.
    expect(resolveAdapter({ kind: "text", text: "x" }).id).toBe("plain-text");
  });
});
