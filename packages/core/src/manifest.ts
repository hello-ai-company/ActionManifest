import { SCHEMA_VERSION, type Action, type ActionManifest } from "@actionmanifest/schema";

export function newActionId(index: number): string {
  return `act_${String(index + 1).padStart(3, "0")}`;
}

export function emptyManifest(
  sourceId: string,
  hash?: string,
  title?: string,
): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: sourceId, ...(hash ? { hash } : {}), ...(title ? { title } : {}) },
    actions: [],
  };
}

export function requireEvidence(action: Action): void {
  if (!action.evidence?.length) {
    throw new Error(`Action ${action.id} violates constitution: no Evidence`);
  }
}
