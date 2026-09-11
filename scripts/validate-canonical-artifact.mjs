#!/usr/bin/env node
/**
 * Stage-time full canonical identity validation.
 * Network: none. Fail closed when --git-sha is supplied but identity is missing.
 */
import { resolve } from "node:path";
import { validateCanonicalReleaseDir } from "./canonical-validate.mjs";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const dir = resolve(arg("--dir") || "release-artifacts");
const gitSha = arg("--git-sha");
const version = arg("--version");
if (!gitSha) {
  console.error("validate-canonical-artifact FAIL: --git-sha is required");
  process.exit(1);
}

try {
  const result = validateCanonicalReleaseDir({
    dir,
    expectedHead: gitSha,
    expectedVersion: version,
    requireIdentity: true,
  });
  console.log(`canonical identity OK (${result.packages} packages, identity present)`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`validate-canonical-artifact FAIL: ${message}`);
  process.exit(1);
}
