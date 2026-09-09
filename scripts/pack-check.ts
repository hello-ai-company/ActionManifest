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
  "adapter-xberg",
] as const;

/** Packages that are allowed to depend on the native Xberg binding. */
const XBERG_ALLOWED_PACKAGES = new Set(["adapter-xberg"]);

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
  "adapter-xberg": ["package/dist/index.js", "package/dist/index.d.ts"],
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

interface PackedPackage {
  dir: string;
  json: {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
  };
}
const packed = new Map<string, PackedPackage>();

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
      peerDependencies?: Record<string, string>;
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
      // Native dependency containment: only the Xberg adapter package may
      // depend on @xberg-io/* — core and the other packages stay parser-free.
      if (dep.startsWith("@xberg-io/") && !XBERG_ALLOWED_PACKAGES.has(pkg)) {
        fail(`${pkg}: Xberg dependency leaked into a non-adapter package (${dep})`);
      }
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
    packed.set(pkg, { dir: join(extractDir, "package"), json: packedJson });
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
import { mapXbergResultToCanonical, XbergAdapter } from "@actionmanifest/adapter-xberg";

if (!actionManifestSchemasByVersion["0.2.0"]) throw new Error("schema assets missing");
// Xberg adapter: pure mapping layer works from the packed artifact WITHOUT
// loading the native binding (dynamic import in the runtime bridge).
const xdoc = mapXbergResultToCanonical(
  { results: [{ content: "pack smoke", mimeType: "text/plain" }], errors: [] },
  { sourceId: "pack-smoke-xberg" },
);
if (xdoc.text !== "pack smoke") throw new Error("xberg mapper wrong");
if (typeof XbergAdapter !== "function") throw new Error("xberg adapter missing");
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

  // Every public type reference in shipped .d.ts files must be declared in
  // the package's own dependencies — a monorepo can accidentally resolve
  // undeclared packages via hoisting, hiding the leak from consumers.
  checkDeclaredTypeDeps(packed);

  // Standalone consumer proof for the isolated native-adapter package:
  // tarball + declared dependencies only, no monorepo hoisting.
  standaloneConsumerCheck(packed);

  console.log(
    `pack:check PASS (${packedNames.length} packages packed, verified, runtime-smoked, type-deps declared, standalone consumer OK)`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

/** Scan shipped .d.ts for external package references and require them declared. */
function checkDeclaredTypeDeps(packed: Map<string, PackedPackage>): void {
  const refPattern = /(?:from|import)\s*\(?\s*["'](@[a-z0-9-]+\/[a-z0-9-]+)["']/gi;
  for (const [pkg, info] of packed) {
    const declared = new Set([
      ...Object.keys(info.json.dependencies ?? {}),
      ...Object.keys(info.json.peerDependencies ?? {}),
    ]);
    const distDir = join(info.dir, "dist");
    if (!existsSync(distDir)) continue;
    const stack = [distDir];
    const files: string[] = [];
    while (stack.length) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) stack.push(p);
        else if (entry.name.endsWith(".d.ts")) files.push(p);
      }
    }
    for (const file of files) {
      const content = readFileSync(file, "utf8");
      for (const match of content.matchAll(refPattern)) {
        const ref = match[1]!;
        if (ref.startsWith("@actionmanifest/") && ref === info.json.name) continue;
        if (!declared.has(ref)) {
          fail(
            `${pkg}: ${file.slice(file.indexOf("dist"))} references "${ref}" in its public types, but it is not declared in dependencies/peerDependencies`,
          );
        }
      }
    }
  }
}

/**
 * Prove a packed package works standalone: extract the tarball plus exactly
 * its declared dependencies (recursively), then typecheck and run a tiny
 * consumer. No workspace hoisting involved.
 */
function standaloneConsumerCheck(packed: Map<string, PackedPackage>): void {
  const target = "adapter-xberg";
  const info = packed.get(target);
  if (!info) fail(`${target} was not packed`);

  const standalone = join(work, "standalone");
  const modules = join(standalone, "node_modules");
  mkdirSync(join(modules, "@actionmanifest"), { recursive: true });

  const seen = new Set<string>();
  const install = (name: string): void => {
    if (seen.has(name)) return;
    seen.add(name);
    if (name.startsWith("@actionmanifest/")) {
      const short = name.slice("@actionmanifest/".length);
      const dep = packed.get(short);
      if (!dep) fail(`${target}: undeclared internal dependency ${name}`);
      cpSync(dep.dir, join(modules, "@actionmanifest", short), { recursive: true });
      for (const d of Object.keys(dep.json.dependencies ?? {})) install(d);
    } else {
      // External dependency: link from the workspace store (offline).
      // Note: some packages (e.g. Xberg) do not export ./package.json, so
      // resolve the directory directly instead of require.resolve on it.
      const direct = join(root, "node_modules", name);
      let pkgDir: string | undefined;
      if (existsSync(join(direct, "package.json"))) {
        pkgDir = direct;
      } else {
        let dir = dirname(require.resolve(name));
        while (dir !== dirname(dir)) {
          if (existsSync(join(dir, "package.json"))) {
            pkgDir = dir;
            break;
          }
          dir = dirname(dir);
        }
      }
      if (!pkgDir) fail(`cannot resolve installed package dir for ${name}`);
      const dest = join(modules, name);
      mkdirSync(dirname(dest), { recursive: true });
      if (!existsSync(dest)) symlinkSync(pkgDir, dest, "dir");
    }
  };
  for (const d of Object.keys(info.json.dependencies ?? {})) install(d);
  cpSync(info.dir, join(modules, "@actionmanifest", target), { recursive: true });

  writeFileSync(join(standalone, "package.json"), JSON.stringify({ type: "module" }), "utf8");
  writeFileSync(
    join(standalone, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["consumer.ts"],
    }),
    "utf8",
  );
  writeFileSync(
    join(standalone, "consumer.ts"),
    `import { XbergAdapter, mapXbergResultToCanonical } from "@actionmanifest/adapter-xberg";
const adapter = new XbergAdapter();
const doc = mapXbergResultToCanonical(
  { results: [{ content: "hello", mimeType: "text/plain" }], errors: [] },
  { sourceId: "doc-1" },
);
void adapter;
void doc;
`,
    "utf8",
  );
  writeFileSync(
    join(standalone, "smoke.mjs"),
    `import { XbergAdapter, mapXbergResultToCanonical } from "@actionmanifest/adapter-xberg";
const doc = mapXbergResultToCanonical(
  { results: [{ content: "hello", mimeType: "text/plain" }], errors: [] },
  { sourceId: "doc-1" },
);
if (doc.text !== "hello") throw new Error("standalone mapper wrong");
if (typeof XbergAdapter !== "function") throw new Error("standalone adapter missing");
console.log("STANDALONE-OK");
`,
    "utf8",
  );

  const tscBin = join(root, "node_modules", ".bin", "tsc");
  run(tscBin, ["--noEmit", "-p", "."], standalone);
  const smoke = run("node", ["smoke.mjs"], standalone);
  if (!smoke.includes("STANDALONE-OK")) fail("standalone runtime smoke did not complete");
  console.log(`  ✓ @actionmanifest/${target} standalone consumer (declared deps only): tsc + runtime OK`);
}
