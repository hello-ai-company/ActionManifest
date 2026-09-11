import {
  DocumentAdapterError,
  UnsupportedInputError,
  type CanonicalDocument,
} from "@actionmanifest/core";
import type { DocumentAdapter } from "@actionmanifest/adapters";
import { mapXbergResultToCanonical } from "./mapper.js";
import type { XbergAdapterInput } from "./types.js";

function isRemoteUri(uri: string): boolean {
  return /^https?:\/\//i.test(uri);
}

interface XbergRuntimeInput {
  kind: "uri" | "bytes";
  uri?: string;
  bytes?: Uint8Array;
  filename?: string;
  mimeType?: string;
}

/**
 * Runtime bridge (Layer B) — the only place that touches the Xberg runtime.
 * The import is dynamic so consumers who only need the pure mapper
 * (Layer A) never load the native binding.
 *
 * @experimental Native (NAPI) runtime path — see XbergAdapter.
 */
async function runXberg(input: XbergRuntimeInput): Promise<unknown> {
  const { extract, ExtractInputKind } = await import("@xberg-io/xberg");
  if (input.kind === "uri") {
    return extract({
      kind: ExtractInputKind.Uri,
      uri: input.uri!,
      ...(input.mimeType ? { mimeType: input.mimeType } : {}),
    });
  }
  return extract({
    kind: ExtractInputKind.Bytes,
    bytes: input.bytes!,
    ...(input.filename ? { filename: input.filename } : {}),
    ...(input.mimeType ? { mimeType: input.mimeType } : {}),
  });
}

/**
 * Xberg reference adapter (Layer B — native runtime bridge).
 *
 * Boundary: Xberg (native/Rust engine) runs upstream or inside Layer B; the
 * adapter emits only CanonicalDocument. It never extracts Actions, never
 * fetches remote URLs unless the caller explicitly set `allowRemote: true`,
 * and never invents pages/bboxes the upstream result does not carry.
 *
 * Stability note: the pure structural mapper `mapXbergResultToCanonical`
 * (Layer A) is NOT experimental — it validates and maps serialized results
 * with no native code and no network.
 *
 * @experimental The native runtime bridge (`xberg-uri` / `xberg-bytes`
 * inputs, which dynamically import the NAPI binding) is experimental in the
 * 0.x line: verified against `@xberg-io/xberg` exactly 1.1.3 (pinned), Node
 * >= 22. Default `pnpm test` stays portable; Release Check gates a real
 * native smoke (2/2 synthetic fixtures) on the canonical tarball. Local
 * opt-in: `pnpm xberg:integration`. The bridge API may change between 0.x
 * minors; the Layer A mapper follows the normal 0.x policy.
 */
export class XbergAdapter implements DocumentAdapter<XbergAdapterInput> {
  readonly id = "xberg";

  canHandle(input: XbergAdapterInput): boolean {
    return (
      input.kind === "xberg-uri" ||
      input.kind === "xberg-bytes" ||
      input.kind === "xberg-result"
    );
  }

  async toCanonical(input: XbergAdapterInput): Promise<CanonicalDocument> {
    if (input.kind === "xberg-result") {
      return mapXbergResultToCanonical(input.payload, {
        sourceId: input.sourceId,
        ...(input.title ? { title: input.title } : {}),
      });
    }
    if (input.kind === "xberg-uri") {
      if (isRemoteUri(input.uri) && input.allowRemote !== true) {
        throw new UnsupportedInputError(
          "Remote http(s) extraction requires explicit allowRemote: true — the adapter never fetches the network on its own.",
          { uri: input.uri },
        );
      }
      let result: unknown;
      try {
        result = await runXberg({ kind: "uri", uri: input.uri, ...(input.mimeType ? { mimeType: input.mimeType } : {}) });
      } catch (e) {
        throw new DocumentAdapterError(
          `Xberg extraction failed for ${input.uri}`,
          { cause: e instanceof Error ? e.message : String(e) },
          "XBERG_RUNTIME",
        );
      }
      return mapXbergResultToCanonical(result, {
        sourceId: input.sourceId,
        ...(input.title ? { title: input.title } : {}),
      });
    }
    if (input.kind === "xberg-bytes") {
      let result: unknown;
      try {
        result = await runXberg({
          kind: "bytes",
          bytes: input.bytes,
          ...(input.filename ? { filename: input.filename } : {}),
          ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        });
      } catch (e) {
        throw new DocumentAdapterError(
          "Xberg extraction failed for bytes input",
          { cause: e instanceof Error ? e.message : String(e) },
          "XBERG_RUNTIME",
        );
      }
      return mapXbergResultToCanonical(result, {
        sourceId: input.sourceId,
        ...(input.title ? { title: input.title } : {}),
      });
    }
    throw new UnsupportedInputError("XbergAdapter handles xberg-uri / xberg-bytes / xberg-result only", {
      received: (input as { kind?: string }).kind,
    });
  }
}
