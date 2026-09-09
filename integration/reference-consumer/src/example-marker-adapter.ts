/**
 * Compile-only proof: a third-party adapter defines its OWN input type and
 * implements DocumentAdapter<ItsInput> — without the central
 * @actionmanifest/adapters package knowing anything about it. This file is
 * typechecked by the reference-consumer package (tsc --noEmit) and exercised
 * at runtime by the integration tests.
 */
import { ensureSourceHash, type CanonicalDocument } from "@actionmanifest/core";
import type { DocumentAdapter } from "@actionmanifest/adapters";

/** A hypothetical Marker parser's input — NOT part of the central union. */
export interface MarkerInput {
  kind: "marker-json";
  sourceId: string;
  payload: unknown;
}

export class ExampleMarkerAdapter implements DocumentAdapter<MarkerInput> {
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
