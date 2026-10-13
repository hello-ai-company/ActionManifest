import { ActionManifestError } from "@actionmanifest/core";
import { explainManifest, type ActionGuidanceReport } from "@actionmanifest/consumer";
import { runAgentRequest } from "./agent.js";

/** Reuse the bounded offline verifier path; no provider selection or execution. */
export async function explainCandidate(raw: unknown, text: string, includeEvidence = false): Promise<ActionGuidanceReport> {
  // Inspect only the source label before entering the existing bounded verifier.
  // Do not run recursive schema validation ahead of its depth/byte guards.
  const source = raw && typeof raw === "object" && "source" in raw ? raw.source : undefined;
  const sourceId = source && typeof source === "object" && "id" in source ? source.id : undefined;
  const result = await runAgentRequest({ protocol_version: "1", operation: "verify", source: { id: sourceId, text }, manifest: raw });
  return explainManifest(result.manifest, { includeEvidence });
}
export function explanationFailure(): ActionManifestError {
  return new ActionManifestError("EXPLANATION_INPUT_INVALID", "Cannot explain this candidate. Use a bounded schema 0.2.0 proposed/verified manifest with matching provenance and exact source. Input details omitted.");
}
