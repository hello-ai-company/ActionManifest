/**
 * release:dry-run — produce and verify release artifacts WITHOUT any registry
 * write. This is the closest we get to a release without performing one.
 *
 * Outputs (gitignored release-artifacts/):
 *   tarballs/*.tgz          — `pnpm pack` of every public package
 *   SHA256SUMS              — sha256 of every tarball
 *   release-manifest.json   — versions, hashes, sizes, engines, dep graph,
 *                             computed publish order, version axes
 *   sbom.cdx.json           — CycloneDX 1.5 SBOM (first-party packages + the
 *                             full external production dependency closure,
 *                             resolved offline from the installed tree)
 *
 * Verification: the packed CLI tarball is installed into a fresh project
 * (offline; internal deps redirected to the local tarballs) and the bin shim
 * is smoke-tested from a foreign cwd (shared gate: scripts/cli-install-smoke).
 *
 * HARD GUARANTEE: this script never publishes. It runs `pnpm pack` only,
 * refuses to run if argv contains "publish", and fails if the repository
 * .npmrc contains registry credentials.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliInstallSmoke } from "./cli-install-smoke.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release-artifacts");
const tarballsDir = join(outDir, "tarballs");

const PUBLIC_PACKAGE_DIRS = [
  "packages/schema",
  "packages/core",
  "packages/temporal",
  "packages/adapters",
  "packages/extractor",
  "packages/verifier",
  "packages/exporters",
  "packages/consumer",
  "packages/adapter-xberg",
  "apps/cli",
] as const;

interface PackageJson {
  name: string;
  version: string;
  license?: string;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

function fail(message: string): never {
  console.error(`release:dry-run FAIL: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// ---------- accidental-publish guard ----------
if (process.argv.slice(2).some((a) => /publish/i.test(a))) {
  fail("refusing to run: argv contains 'publish'. This script packs; it never publishes.");
}
const repoNpmrc = join(root, ".npmrc");
if (existsSync(repoNpmrc)) {
  const npmrc = readFileSync(repoNpmrc, "utf8");
  if (/_auth(Token)?|_password|_auth\s*=|registry.*:.*_auth/i.test(npmrc)) {
    fail("repository .npmrc contains registry credentials — remove them before any release activity");
  }
}

// ---------- git state ----------
const head = run("git", ["rev-parse", "HEAD"], root);
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root);
const dirty = run("git", ["status", "--porcelain"], root).length > 0;

// ---------- pack all public packages ----------
rmSync(outDir, { recursive: true, force: true });
mkdirSync(tarballsDir, { recursive: true });

interface PackedEntry {
  pkg: PackageJson & { name: string; version: string };
  dir: string;
  /** Path relative to release-artifacts/ (for the manifest). */
  tarball: string;
  /** Absolute path to the .tgz */
  absTarball: string;
  sha256: string;
  bytes: number;
}
const entries: PackedEntry[] = [];
for (const dir of PUBLIC_PACKAGE_DIRS) {
  run("pnpm", ["pack", "--pack-destination", tarballsDir], join(root, dir));
}
for (const file of readdirSync(tarballsDir).filter((f) => f.endsWith(".tgz")).sort()) {
  const tgz = join(tarballsDir, file);
  const sha256 = createHash("sha256").update(readFileSync(tgz)).digest("hex");
  // Read the packed manifest from the tarball itself (post workspace:* rewrite).
  const raw = execFileSync("tar", ["-xzf", tgz, "-O", "package/package.json"], { encoding: "utf8" });
  const pkg = JSON.parse(raw) as PackageJson;
  const dir = PUBLIC_PACKAGE_DIRS.find((d) => d.endsWith(`/${pkg.name.split("/")[1]}`));
  entries.push({
    pkg,
    dir: dir ?? "",
    tarball: `tarballs/${file}`,
    absTarball: tgz,
    sha256,
    bytes: statSync(tgz).size,
  });
  console.log(`  packed ${pkg.name}@${pkg.version} (${file}, sha256 ${sha256.slice(0, 12)}…)`);
}
if (entries.length !== PUBLIC_PACKAGE_DIRS.length) {
  fail(`expected ${PUBLIC_PACKAGE_DIRS.length} tarballs, got ${entries.length}`);
}

// ---------- SHA256SUMS ----------
const sums = entries.map((e) => `${e.sha256}  ${e.tarball.replace(/^tarballs\//, "")}`).join("\n") + "\n";
writeFileSync(join(outDir, "SHA256SUMS"), sums, "utf8");

// ---------- publish order (topological; STOP on cycle) ----------
const byName = new Map(entries.map((e) => [e.pkg.name, e]));
const INTERNAL = new Set([...byName.keys()]);
const depthMemo = new Map<string, number>();
function depth(name: string, stack: string[]): number {
  const memo = depthMemo.get(name);
  if (memo !== undefined) return memo;
  if (stack.includes(name)) {
    fail(`circular package dependency detected: ${[...stack, name].join(" → ")}`);
  }
  const entry = byName.get(name);
  if (!entry) fail(`internal dependency ${name} was not packed`);
  const internalDeps = Object.keys(entry.pkg.dependencies ?? {}).filter((d) => INTERNAL.has(d));
  const d = internalDeps.length === 0 ? 0 : Math.max(...internalDeps.map((dep) => depth(dep, [...stack, name]))) + 1;
  depthMemo.set(name, d);
  return d;
}
const publishOrder = [...byName.keys()].sort((a, b) => {
  const da = depth(a, []);
  const db = depth(b, []);
  return da !== db ? da - db : a.localeCompare(b);
});

// ---------- version axes ----------
const conformanceManifest = JSON.parse(
  readFileSync(join(root, "conformance/manifest.json"), "utf8"),
) as { suite_version: string; schema_versions: string[] };
const xbergPin = entries.find((e) => e.pkg.name === "@actionmanifest/adapter-xberg")?.pkg
  .dependencies?.["@xberg-io/xberg"];

const manifest = {
  kind: "actionmanifest-release-dry-run",
  dry_run: true,
  registry_writes: "none (pack only; publish is a separate, gated phase)",
  generated_by: "scripts/release-dry-run.ts",
  git: { head, branch, dirty },
  node: process.version,
  package_manager: `pnpm@${run("pnpm", ["--version"], root)}`,
  axes: {
    package_version: entries[0]?.pkg.version,
    schema_versions: conformanceManifest.schema_versions,
    conformance_suite_version: conformanceManifest.suite_version,
    note: "package version ≠ schema version ≠ suite version (docs/COMPATIBILITY.md)",
  },
  xberg: {
    package: "@xberg-io/xberg",
    specifier: xbergPin,
    policy: "exact pin for RC (docs/adr/0007-release-versioning-and-supply-chain.md)",
  },
  publish_order: publishOrder,
  packages: entries.map((e) => ({
    name: e.pkg.name,
    version: e.pkg.version,
    dir: e.dir,
    tarball: e.tarball,
    sha256: e.sha256,
    bytes: e.bytes,
    engines_node: e.pkg.engines?.node,
    license: e.pkg.license,
    dependencies: e.pkg.dependencies ?? {},
  })),
};
writeFileSync(join(outDir, "release-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

// ---------- SBOM (CycloneDX 1.5) ----------
interface ExternalComponent {
  name: string;
  version: string;
  license?: string;
  scope: "required" | "optional";
  dependencies: Record<string, string>;
}
function purl(name: string, version: string): string {
  return `pkg:npm/${name.replace("@", "%40")}@${version}`;
}
function readInstalled(name: string): (PackageJson & { version: string }) | undefined {
  const path = join(root, "node_modules", name, "package.json");
  if (!existsSync(path)) return undefined;
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson & { version: string };
}

const external = new Map<string, ExternalComponent>();
const queue: { name: string; range: string; scope: "required" | "optional" }[] = [];
for (const e of entries) {
  for (const [dep, range] of Object.entries(e.pkg.dependencies ?? {})) {
    if (!INTERNAL.has(dep)) queue.push({ name: dep, range, scope: "required" });
  }
}
const declaredRanges = new Map<string, string>();
while (queue.length > 0) {
  const { name, range, scope } = queue.shift()!;
  const existing = external.get(name);
  if (existing) {
    if (scope === "required") existing.scope = "required";
    continue;
  }
  declaredRanges.set(name, range);
  const installed = readInstalled(name);
  if (!installed) {
    // Optional platform-specific binaries (e.g. Xberg darwin/win32) are not
    // installed on this OS — record them unresolved instead of failing.
    if (scope === "optional") {
      external.set(name, { name, version: range, license: undefined, scope, dependencies: {} });
      continue;
    }
    fail(`external dependency ${name} is not installed (run pnpm install)`);
  }
  external.set(name, {
    name,
    version: installed.version,
    license: installed.license,
    scope,
    dependencies: installed.dependencies ?? {},
  });
  for (const [dep, depRange] of Object.entries(installed.dependencies ?? {})) {
    queue.push({ name: dep, range: depRange, scope });
  }
  for (const [dep, depRange] of Object.entries(installed.optionalDependencies ?? {})) {
    queue.push({ name: dep, range: depRange, scope: "optional" });
  }
}

const sbom = {
  bomFormat: "CycloneDX",
  specVersion: "1.5",
  version: 1,
  metadata: {
    component: {
      type: "application",
      "bom-ref": "pkg:npm/actionmanifest-dry-run",
      name: "actionmanifest",
      version: entries[0]?.pkg.version,
      licenses: [{ license: { id: "Apache-2.0" } }],
    },
    properties: [
      { name: "actionmanifest:dry_run", value: "true" },
      { name: "actionmanifest:git_head", value: head },
    ],
  },
  components: [
    ...entries.map((e) => ({
      type: "library",
      "bom-ref": purl(e.pkg.name, e.pkg.version),
      scope: "required",
      name: e.pkg.name,
      version: e.pkg.version,
      licenses: [{ license: { id: "Apache-2.0" } }],
      purl: purl(e.pkg.name, e.pkg.version),
      properties: [
        { name: "actionmanifest:tarball_sha256", value: e.sha256 },
        { name: "actionmanifest:tarball", value: e.tarball },
      ],
    })),
    ...[...external.values()].map((c) => ({
      type: "library",
      "bom-ref": purl(c.name, c.version),
      scope: c.scope,
      name: c.name,
      version: c.version,
      ...(c.license ? { licenses: [{ license: { name: c.license } }] } : {}),
      purl: purl(c.name, c.version),
    })),
  ],
  dependencies: [
    ...entries.map((e) => ({
      ref: purl(e.pkg.name, e.pkg.version),
      dependsOn: Object.entries(e.pkg.dependencies ?? {}).map(([name, range]) => {
        if (INTERNAL.has(name)) {
          const target = byName.get(name)!;
          return purl(name, target.pkg.version);
        }
        const resolved = external.get(name);
        return purl(name, resolved?.version ?? range);
      }),
    })),
    ...[...external.values()].map((c) => ({
      ref: purl(c.name, c.version),
      dependsOn: Object.entries({ ...c.dependencies }).map(([name, range]) => {
        const resolved = external.get(name);
        return purl(name, resolved?.version ?? range);
      }),
    })),
  ],
};
writeFileSync(join(outDir, "sbom.cdx.json"), JSON.stringify(sbom, null, 2) + "\n", "utf8");

// ---------- install smoke on the produced artifacts ----------
const cliEntry = entries.find((e) => e.pkg.name === "@actionmanifest/cli");
if (!cliEntry) fail("cli tarball missing");
cliInstallSmoke({
  cliTarball: cliEntry.absTarball,
  expectedVersion: cliEntry.pkg.version,
  libraryTarballs: new Map(
    entries
      .filter((e) => e.pkg.name !== "@actionmanifest/cli")
      .map((e) => [e.pkg.name.split("/")[1]!, e.absTarball]),
  ),
  expectedConformanceTotal: 65,
});

console.log(
  `release:dry-run PASS — ${entries.length} tarballs, SHA256SUMS, release-manifest.json, sbom.cdx.json (${external.size} external components), publish order: ${publishOrder.join(" → ")}`,
);
console.log(`artifacts: ${outDir}`);
