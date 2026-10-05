import { ActionManifestError, assertCanonicalDocument, ensureSourceHash } from "@actionmanifest/core";
import { MATOE_INPUT_LIMITS, prepareMatoeV02Manifest } from "@actionmanifest/consumer";
import { ActionExtractor, DeterministicProvider } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";

// JSON can escape a lone UTF-16 surrogate even when transport UTF-8 is valid.
const malformedUnicode = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

/** Python passes only these two fields, not its entire legacy AnalysisRequest. */
export async function analyzeMatoeRequest(input: unknown) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ActionManifestError("MATOE_REQUEST_INVALID", "Expected an analysis request object");
  const record = input as Record<string, unknown>;
  if (Object.keys(record).length !== 2 || !Object.hasOwn(record, "sourceId") || !Object.hasOwn(record, "ocrText")
    || typeof record.sourceId !== "string" || !record.sourceId.trim() || Array.from(record.sourceId).length > 256
    || typeof record.ocrText !== "string" || !record.ocrText.trim()
    || malformedUnicode(record.sourceId) || malformedUnicode(record.ocrText)) {
    throw new ActionManifestError("MATOE_REQUEST_INVALID", "Invalid source identity or canonical OCR input");
  }
  if (Buffer.byteLength(record.ocrText, "utf8") > MATOE_INPUT_LIMITS.ocrBytes
    || Array.from(record.ocrText).length > MATOE_INPUT_LIMITS.ocrScalars) {
    throw new ActionManifestError("MATOE_INPUT_TOO_LARGE", "Canonical OCR exceeds the input budget");
  }
  // Matoe sends text, not verified page geometry. Do not invent page 1/bbox
  // for a flattened multi-page PDF or infer a page from user-authored markers.
  const sourceId = record.sourceId;
  const ocrText = record.ocrText;
  const doc = assertCanonicalDocument(ensureSourceHash({ id: sourceId, text: ocrText }));
  // Explicit provider construction prevents environment selection / paid fallback.
  const candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
  const { manifest } = verifyManifest(candidate, doc);
  // Use the already captured canonical input, not the caller's mutable object
  // after extraction yielded. Result validation belongs to this request.
  return prepareMatoeV02Manifest(manifest, ocrText, sourceId);
}

export async function readMatoeStdin(stream: AsyncIterable<Buffer>): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > MATOE_INPUT_LIMITS.manifestBytes) throw new ActionManifestError("MATOE_INPUT_TOO_LARGE", "Analysis request exceeds the input budget");
    chunks.push(chunk);
  }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { throw new ActionManifestError("MATOE_REQUEST_INVALID", "Expected valid UTF-8 JSON request"); }
}

/** Fixed codes/messages only; never log caught exception text or request data. */
export function matoeAnalysisFailure(error: unknown) {
  const messages: Record<string, string> = {
    MATOE_REQUEST_INVALID: "Invalid analysis request",
    MATOE_INPUT_TOO_LARGE: "Analysis request exceeds the input budget",
    MATOE_V02_CONTRACT_BLOCKED: "Analysis cannot satisfy the v0.2 consumer contract",
  };
  const code = error instanceof ActionManifestError && Object.hasOwn(messages, error.code) ? error.code : "MATOE_PIPELINE_FAILED";
  return { error: { code, message: messages[code] ?? "Analysis pipeline failed" } };
}
