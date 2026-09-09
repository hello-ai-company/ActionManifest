import type { ActionManifest } from "@actionmanifest/core";

export function exportJson(manifest: ActionManifest, pretty = true): string {
  return JSON.stringify(manifest, null, pretty ? 2 : 0) + "\n";
}
