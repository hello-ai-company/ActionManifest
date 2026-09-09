/**
 * pack-assets — stage (and clean up) extra files that must ship inside a
 * published tarball but live at the repository root (single source of truth).
 *
 * Usage (from a package directory, via prepack/postpack lifecycle):
 *   node ../../scripts/pack-assets.mjs copy  [conformance] [benchmark]
 *   node ../../scripts/pack-assets.mjs clean [conformance] [benchmark]
 *
 * Always stages the root LICENSE and NOTICE (Apache-2.0 requires both in
 * every distributed artifact). The optional named bundles are:
 *   conformance  → <root>/conformance        (normative suite, read-only copy)
 *   benchmark    → <root>/benchmark/fixtures (synthetic benchmark corpus)
 *
 * Copies are byte-identical and deleted by `clean`; they are gitignored and
 * never modify the source directories, so governance guards (frozen schemas,
 * suite_version) are unaffected.
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkgDir = process.cwd();

const [command, ...bundles] = process.argv.slice(2);
if (command !== "copy" && command !== "clean") {
  console.error(`pack-assets: expected "copy" or "clean", got ${JSON.stringify(command)}`);
  process.exit(2);
}

const LEGAL_FILES = ["LICENSE", "NOTICE"];
const BUNDLES = {
  conformance: { from: join(root, "conformance"), to: join(pkgDir, "conformance") },
  benchmark: { from: join(root, "benchmark", "fixtures"), to: join(pkgDir, "benchmark", "fixtures") },
};

for (const name of bundles) {
  if (!BUNDLES[name]) {
    console.error(`pack-assets: unknown bundle ${JSON.stringify(name)}`);
    process.exit(2);
  }
}

if (command === "copy") {
  for (const file of LEGAL_FILES) {
    cpSync(join(root, file), join(pkgDir, file));
  }
  for (const name of bundles) {
    const { from, to } = BUNDLES[name];
    if (!existsSync(from)) {
      console.error(`pack-assets: source missing: ${from}`);
      process.exit(1);
    }
    rmSync(to, { recursive: true, force: true });
    cpSync(from, to, { recursive: true });
  }
} else {
  for (const file of LEGAL_FILES) {
    rmSync(join(pkgDir, file), { force: true });
  }
  for (const name of bundles) {
    rmSync(BUNDLES[name].to, { recursive: true, force: true });
    if (name === "benchmark") rmSync(join(pkgDir, "benchmark"), { recursive: true, force: true });
  }
}
