#!/usr/bin/env node
/**
 * Stage-time protected v* tag contract. Network: none (local files only).
 * Prints the SemVer (without the leading v) on success.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { assertProtectedReleaseTag } from "./semver.mjs";

function arg(flag) {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function fail(message) {
  console.error(`assert-release-tag FAIL: ${message}`);
  process.exit(1);
}

function lockstepPackageJsons(root) {
  const files = [];
  const packagesDir = join(root, "packages");
  if (existsSync(packagesDir)) {
    for (const name of readdirSync(packagesDir).sort()) {
      const file = join(packagesDir, name, "package.json");
      if (existsSync(file)) files.push(file);
    }
  }
  const cli = join(root, "apps", "cli", "package.json");
  if (existsSync(cli)) files.push(cli);
  return files;
}

const tag = arg("--tag");
if (!tag) fail("--tag is required");

let parsed;
try {
  parsed = assertProtectedReleaseTag(tag);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const expected = arg("--expected-version");
if (expected) {
  try {
    assertProtectedReleaseTag(tag, expected);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
}

const root = resolve(arg("--root") || ".");
const manifests = lockstepPackageJsons(root);
if (manifests.length === 0 && (expected || arg("--root"))) {
  fail(`no lockstep package.json files under ${root}`);
}
for (const file of manifests) {
  let version;
  try {
    version = JSON.parse(readFileSync(file, "utf8")).version;
  } catch {
    fail(`cannot read version from ${file}`);
  }
  try {
    assertProtectedReleaseTag(tag, version);
  } catch (error) {
    fail(`${error instanceof Error ? error.message : String(error)} (${file})`);
  }
}

console.log(parsed.version);
