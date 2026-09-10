/**
 * bootstrap:check — Phase 2.4A first-release bootstrap preparation.
 *
 * DRY RUN ONLY. This script NEVER publishes, NEVER creates tags or GitHub
 * Releases, and NEVER touches npm authentication. It prepares and verifies
 * everything a maintainer needs for the manual, 2FA-protected bootstrap
 * publish of 0.9.0-rc.0 (docs/RELEASING.md §"First-ever publish").
 *
 * Steps:
 *   1. Run the release dry-run (packs exact tarballs + SBOM + manifest).
 *   2. Version gate: all 10 public packages MUST equal the bootstrap
 *      candidate version (0.9.0-rc.0).
 *   3. Registry preflight (READ-ONLY): every @actionmanifest/* package MUST
 *      be 404 (not yet published). A network failure is BLOCKED/UNKNOWN —
 *      never silently treated as 404.
 *   4. Emit release-artifacts/bootstrap-plan.json — the machine-readable
 *      publish plan (exact tarball paths, sha256, publish commands with
 *      --access public --tag next) in the manifest's computed publish order.
 *
 * Exit codes: 0 = READY FOR MANUAL BOOTSTRAP, 1 = NOT READY (version /
 * registry / artifact mismatch), 2 = BLOCKED/UNKNOWN (preflight could not
 * be completed, e.g. network failure).
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release-artifacts");

/** The Phase 2.4A bootstrap candidate. rc.1+ releases use the OIDC workflow. */
export const EXPECTED_BOOTSTRAP_VERSION = "0.9.0-rc.0";
export const BOOTSTRAP_DIST_TAG = "next";
export const BOOTSTRAP_ACCESS = "public";

const PACKAGE_NAMES = [
  "@actionmanifest/schema",
  "@actionmanifest/core",
  "@actionmanifest/temporal",
  "@actionmanifest/adapters",
  "@actionmanifest/extractor",
  "@actionmanifest/verifier",
  "@actionmanifest/exporters",
  "@actionmanifest/consumer",
  "@actionmanifest/adapter-xberg",
  "@actionmanifest/cli",
] as const;

function fail(message: string, code = 1): never {
  console.error(`bootstrap:check ${code === 2 ? "BLOCKED" : "NOT READY"}: ${message}`);
  process.exit(code);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

// ---------- accidental-publish guard (fail closed) ----------
if (process.argv.slice(2).some((a) => /publish/i.test(a))) {
  fail("refusing to run: argv contains 'publish'. This script plans; it never publishes.", 2);
}
for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
  if (process.env[tokenVar]) {
    fail(`${tokenVar} is present — bootstrap preparation is credential-free. Unset it.`, 2);
  }
}

// ---------- 1. release dry-run (exact artifacts) ----------
console.log("bootstrap:check — running release:dry-run (pack + verify artifacts)…");
execFileSync("pnpm", ["release:dry-run"], { cwd: root, stdio: "inherit" });

// ---------- 2. version gate ----------
const manifestPath = join(outDir, "release-manifest.json");
if (!existsSync(manifestPath)) {
  fail("release-artifacts/release-manifest.json missing — dry-run did not produce it");
}
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
};

const byName = new Map(manifest.packages.map((p) => [p.name, p]));
for (const name of PACKAGE_NAMES) {
  const entry = byName.get(name);
  if (!entry) fail(`expected package ${name} missing from release manifest`);
  if (entry.version !== EXPECTED_BOOTSTRAP_VERSION) {
    fail(
      `version gate: ${name} is ${entry.version}, expected ${EXPECTED_BOOTSTRAP_VERSION} (lockstep bootstrap candidate)`,
    );
  }
}
console.log(`  ✓ version gate: all ${PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}`);

// ---------- 3. registry preflight (read-only; 404 expected) ----------
console.log("bootstrap:check — registry preflight (read-only; every package must be 404)…");
const preflight: { name: string; status: "absent" | "exists" }[] = [];
for (const name of PACKAGE_NAMES) {
  const probe = execFileSyncSafe("npm", ["view", name, "version", "--registry", "https://registry.npmjs.org/"]);
  if (probe.error === "network") {
    fail(
      `registry preflight could not complete for ${name}: network/registry unreachable. ` +
        `Bootstrap readiness is UNKNOWN — do not proceed on assumption.`,
      2,
    );
  }
  if (probe.error === null) {
    fail(
      `registry state changed: ${name} already exists on npm (version ${probe.stdout}). ` +
        `Expected 404 for the first-ever bootstrap. Investigate before proceeding.`,
    );
  }
  preflight.push({ name, status: "absent" });
  console.log(`  ✓ ${name}: 404 (not published — as expected)`);
}

function execFileSyncSafe(
  cmd: string,
  args: string[],
): { error: null | "network" | "notfound"; stdout: string } {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 30_000,
    }).trim();
    return { error: null, stdout };
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "");
    const message = String((e as Error).message ?? "");
    if (/E404|404 Not Found/.test(stderr) || /E404|404 Not Found/.test(message)) {
      return { error: "notfound", stdout: "" };
    }
    return { error: "network", stdout: "" };
  }
}

// ---------- 4. bootstrap plan ----------
export interface ReleaseManifestLike {
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
}

export interface BootstrapPlan {
  kind: "actionmanifest-bootstrap-plan";
  dry_run: true;
  registry_writes: string;
  version: string;
  dist_tag: string;
  access: string;
  registry: string;
  generated_by: string;
  git: { head: string; branch: string; dirty: boolean };
  publish_order: string[];
  packages: {
    name: string;
    version: string;
    tarball: string;
    sha256: string;
    publish_command: string;
  }[];
  notes: string[];
}

/**
 * Build the machine-readable bootstrap plan from the release manifest's
 * COMPUTED publish order (never a remembered fixed order). Pure function —
 * unit-tested without network or packing.
 */
export function buildBootstrapPlan(
  manifest: ReleaseManifestLike,
  git: { head: string; branch: string; dirty: boolean },
): BootstrapPlan {
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  return {
    kind: "actionmanifest-bootstrap-plan",
    dry_run: true,
    registry_writes: "none (plan only; the manual bootstrap is a maintainer operation)",
    version: EXPECTED_BOOTSTRAP_VERSION,
    dist_tag: BOOTSTRAP_DIST_TAG,
    access: BOOTSTRAP_ACCESS,
    registry: "https://registry.npmjs.org/",
    generated_by: "scripts/bootstrap-release.ts",
    git,
    publish_order: manifest.publish_order,
    packages: manifest.publish_order.map((name) => {
      const entry = byName.get(name);
      if (!entry) throw new Error(`publish_order references unknown package ${name}`);
      return {
        name,
        version: entry.version,
        tarball: `release-artifacts/${entry.tarball}`,
        sha256: entry.sha256,
        publish_command:
          `npm publish ./release-artifacts/${entry.tarball} --access ${BOOTSTRAP_ACCESS} --tag ${BOOTSTRAP_DIST_TAG}`,
      };
    }),
    notes: [
      "Publish EXACTLY these tarballs — never re-pack from a package directory (approved artifact != rebuilt artifact).",
      "Publish in publish_order so dependencies exist on the registry first.",
      "--tag next keeps the bootstrap off the latest dist-tag.",
      "After all 10 packages exist: configure Trusted Publishers (docs/RELEASING.md), then rc.1+ ships via OIDC only.",
    ],
  };
}

const plan = buildBootstrapPlan(manifest, manifestGit());
writeFileSync(join(outDir, "bootstrap-plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

function manifestGit(): { head: string; branch: string; dirty: boolean } {
  return {
    head: run("git", ["rev-parse", "HEAD"], root),
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root),
    dirty: run("git", ["status", "--porcelain"], root).length > 0,
  };
}

// ---------- 5. print the manual plan ----------
console.log("\nManual bootstrap publish commands (MAINTAINER ONLY — 2FA, reviewed tarballs):");
for (const p of plan.packages) {
  console.log(`  # ${p.name}@${p.version} (sha256 ${p.sha256.slice(0, 12)}…)`);
  console.log(`  ${p.publish_command}`);
}
console.log(`\nPlan written: ${join(outDir, "bootstrap-plan.json")}`);
console.log(
  `bootstrap:check READY FOR MANUAL BOOTSTRAP — ${PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}, registry clear (all 404), artifacts verified.`,
);
