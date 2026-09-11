/**
 * release:registry-verify — read-only registry truth for an exact version.
 *
 * Never publishes, stages, approves, or mutates dist-tags.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import { locateArtifactRoot } from "./sha256sums.js";
import { verifyPackagesOnRegistry, type RegistryState } from "./registry-truth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv: string[]): { version: string; artifacts?: string } {
  let version = "";
  let artifacts: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--version") version = argv[++i] ?? "";
    if (argv[i] === "--artifacts") artifacts = argv[++i];
  }
  return { version, artifacts };
}

function loadCanonicalHashes(artifactsDir: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!artifactsDir) return map;
  const start = artifactsDir;
  const dir = existsSync(join(start, "release-manifest.json")) ? start : locateArtifactRoot(start);
  const manifest = JSON.parse(readFileSync(join(dir, "release-manifest.json"), "utf8")) as {
    packages: { name: string; sha256: string }[];
  };
  for (const p of manifest.packages) map.set(p.name, p.sha256);
  return map;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version) {
    console.error("usage: pnpm release:registry-verify --version <exact> [--artifacts <dir>]");
    process.exit(2);
  }
  for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (process.env[tokenVar]) {
      console.error(`release:registry-verify refuses to run with ${tokenVar} set`);
      process.exit(2);
    }
  }
  const artifacts = args.artifacts ?? (existsSync(join(root, "release-artifacts", "release-manifest.json"))
    ? join(root, "release-artifacts")
    : undefined);
  const { reports, overall } = verifyPackagesOnRegistry(PUBLIC_PACKAGE_NAMES, {
    version: args.version,
    canonicalSha256: loadCanonicalHashes(artifacts),
  });
  const payload = {
    kind: "actionmanifest-registry-verify",
    version: args.version,
    overall,
    registry_writes: "none",
    dist_tag_policy: {
      prerelease: "require next=version; do not mutate latest",
      stable: "require latest=version",
      rc0_latest: "0.9.0-rc.0 historically set latest=rc.0 — documented, not auto-repaired",
    },
    reports,
  };
  console.log(JSON.stringify(payload, null, 2));
  const exitByState: Record<RegistryState, number> = {
    PUBLISHED_VERIFIED: 0,
    ABSENT: 1,
    PROPAGATING: 2,
    INCONSISTENT: 1,
    UNKNOWN: 2,
  };
  process.exit(exitByState[overall]);
}

const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main();
}
