import type { CanonicalDocument } from "@actionmanifest/core";

export type AdapterInput =
  | { kind: "text"; id?: string; title?: string; text: string; language?: string }
  | { kind: "path"; path: string; id?: string; title?: string; language?: string }
  | {
      kind: "docling-json";
      id?: string;
      title?: string;
      payload: unknown;
    };

export interface DocumentAdapter {
  readonly id: string;
  canHandle(input: AdapterInput): boolean;
  toCanonical(input: AdapterInput): Promise<CanonicalDocument>;
}
