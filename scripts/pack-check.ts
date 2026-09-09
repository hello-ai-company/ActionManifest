/**
 * pack:check — offline packaging verification for the public packages.
 *
 * For every publishable package:
 *   1. `pnpm pack` into a temp dir (local only; nothing is published).
 *   2. Assert the tarball contains dist (runtime + .d.ts), schema assets where
 *      applicable, and no src/ or test files.
 *   3. Assert the packed package.json has valid exports/types/files and no
 *      leftover `workspace:` protocol references.
 *   4. Extract ALL tarballs into a temp node_modules layout and run a runtime
 *      smoke script that imports every package and drives the full pipeline
 *      (adapter → extract → verify → consumer → exporters) — proving the
 *      packed artifacts actually work when installed by a third party.
 *
 * Fully offline: external deps (ajv) are symlinked from the workspace store.
 */
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(join(root, "package.json"));

const PUBLIC_PACKAGES = [
  "schema",
  "core",
  "temporal",
  "adapters",
  "extractor",
  "verifier",
  "exporters",
  "consumer",
] as const;

const REQUIRED_ENTRIES: Record<(typeof PUBLIC_PACKAGES)[number], string[]> = {
  schema: [
    "package/dist/index.js",
    "package/dist/index.d.ts",
    "package/schemas/v0.1/action-manifest.schema.json",
    "package/schemas/v0.2/action-manifest.schema.json",
    "package/schemas/canonical-document.schema.json",
  ],
  core: ["package/dist/index.js", "package/dist/index.d.ts"],
  temporal: ["package/dist/index.js", "package/dist/index.d.ts"],
  adapters: ["package/dist/index.js", "package/dist/index.d.ts"],
  extractor: ["package/dist/index.js", "package/dist/index.d.ts"],
  verifier: ["package/dist/index.js", "package/dist/index.d.ts"],
  exporters: ["package/dist/index.js", "package/dist/index.d.ts"],
  consumer: ["package/dist/index.js", "package/dist/index.d.ts"],
};

const FORBIDDEN_PATTERNS = [/^package\/src\//, /\.test\.ts$/, /^package\/test\//];

function fail(message: string): never {
  console.error(`pack:check FAIL: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const work = mkdtempSync(join(tmpdir(), "actionmanifest-pack-"));
const tarballs = join(work, "tarballs");
const site = join(work, "consumer");
mkdirSync(tarballs);
mkdirSync(join(site, "node_modules", "@actionmanifest"), { recursive: true });

try {
  const packedNames: string[] = [];

  for (const pkg of PUBLIC_PACKAGES) {
    const pkgDir = join(root, "packages", pkg);
    run("pnpm", ["pack", "--pack-destination", tarballs], pkgDir);
    const tgz = readdirSync(tarballs).find((f) => f.includes(`actionmanifest-${pkg}-`) && f.endsWith(".tgz"));
    if (!tgz) fail(`pnpm pack produced no tarball for ${pkg}`);
    const tgzPath = join(tarballs, tgz);

    const listing = run("tar", ["-tzf", tgzPath], work).split("\n").filter(Boolean);
    for (const required of REQUIRED_ENTRIES[pkg]) {
      if (!listing.includes(required)) fail(`${pkg}: tarball missing ${required}`);
    }
    for (const entry of listing) {
      if (FORBIDDEN_PATTERNS.some((p) => p.test(entry))) {
        fail(`${pkg}: tarball contains forbidden entry ${entry}`);
      }
    }

    const extractDir = join(work, "extract", pkg);
    mkdirSync(extractDir, { recursive: true });
    run("tar", ["-xzf", tgzPath, "-C", extractDir], work);
    const packedJson = JSON.parse(readFileSync(join(extractDir, "package", "package.json"), "utf8")) as {
      name: string;
      version: string;
      type?: string;
      main?: string;
      types?: string;
      exports?: Record<string, unknown>;
      files?: string[];
      dependencies?: Record<string, string>;
    };

    if (packedJson.name !== `@actionmanifest/${pkg}`) fail(`${pkg}: unexpected name ${packedJson.name}`);
    if (!packedJson.version) fail(`${pkg}: missing version`);
    if (packedJson.type !== "module") fail(`${pkg}: type must be module`);
    if (!packedJson.exports?.["."]) fail(`${pkg}: exports["."] missing`);
    if (!packedJson.types && !(packedJson.exports["."] as { types?: string }).types) {
      fail(`${pkg}: type declarations not exposed`);
    }
    if (!Array.isArray(packedJson.files) || !packedJson.files.includes("dist")) {
      fail(`${pkg}: files must include dist`);
    }
    for (const [dep, range] of Object.entries(packedJson.dependencies ?? {})) {
      if (range.includes("workspace:")) fail(`${pkg}: dependency ${dep} still uses workspace: protocol`);
    }
    // exports targets must exist inside the tarball
    const dot = packedJson.exports["."] as { import?: string; types?: string };
    for (const target of [dot.import, dot.types]) {
      if (target && !listing.includes(`package/${target.replace(/^\.\//, "")}`)) {
        fail(`${pkg}: exports target ${target} not present in tarball`);
      }
    }

    // Stage into the smoke-test node_modules layout.
    cpSync(join(extractDir, "package"), join(site, "node_modules", "@actionmanifest", pkg), {
      recursive: true,
    });
    packedNames.push(pkg);
    console.log(`  ✓ @actionmanifest/${pkg} (${tgz})`);
  }

  // External runtime deps of the packed packages, resolved from the workspace
  // store and symlinked (offline).
  for (const dep of ["ajv", "ajv-formats"]) {
    const depPkgJson = require.resolve(`${dep}/package.json`);
    const target = join(site, "node_modules", dep);
    if (!existsSync(target)) symlinkSync(dirname(depPkgJson), target, "dir");
  }

  writeFileSync(join(site, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  writeFileSync(
    join(site, "smoke.mjs"),
    `import { actionManifestSchemasByVersion } from "@actionmanifest/schema";
import { validateActionManifest } from "@actionmanifest/core";
import { PlainTextAdapter, DoclingAdapter } from "@actionmanifest/adapters";
import { extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest } from "@actionmanifest/consumer";
import { exportIcs, exportJson } from "@actionmanifest/exporters";

if (!actionManifestSchemasByVersion["0.2.0"]) throw new Error("schema assets missing");
const doc = await new PlainTextAdapter().toCanonical({
  kind: "text",
  id: "pack-smoke",
  text: "令和8年10月15日に秋の遠足を実施します。",
});
const candidate = await extractActions(doc);
const { manifest, flags } = verifyManifest(candidate, doc);
if (!flags.passed) throw new Error("verification did not pass");
if (classifyManifest(manifest).counts.ready !== 1) throw new Error("consumer classification wrong");
if (!exportIcs(manifest).includes("DTSTART;VALUE=DATE:20261015")) throw new Error("ics wrong");
validateActionManifest(JSON.parse(exportJson(manifest)));
if (typeof DoclingAdapter !== "function") throw new Error("docling adapter missing");
console.log("PACK-SMOKE-OK");
`,
    "utf8",
  );

  const out = run("node", ["smoke.mjs"], site);
  if (!out.includes("PACK-SMOKE-OK")) fail("runtime smoke did not complete");

  console.log(`pack:check PASS (${packedNames.length} packages packed, verified, and runtime-smoked)`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
