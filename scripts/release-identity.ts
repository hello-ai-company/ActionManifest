/**
 * Deterministic release-manifest identity + dist-tag / stage-plan policy.
 *
 * Identity fields are the ones a later job may compare across runs of the
 * same commit. Do NOT add clocks, hostnames, CI run ids, or other
 * non-reproducible values here.
 */
import { basename } from "node:path";

export const PUBLIC_PACKAGE_NAMES = [
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

export const NODE20_CONSUMER_EXCLUDES = ["@actionmanifest/adapter-xberg"] as const;

export const PINNED_NPM_CLI = "11.15.0";
export const PINNED_PNPM = "11.23.0";
export const CANONICAL_REGISTRY = "https://registry.npmjs.org/";
export const EXPECTED_PACKAGE_COUNT = 10;

/** rc.0 first-publish accidentally set `latest` as well as `next`. Document only. */
export const RC0_HISTORICAL_LATEST = "0.9.0-rc.0";

export interface ReleaseIdentity {
  version: string;
  git_sha: string;
  git_tree: string;
  package_manager: string;
  node_version: string;
  platform: string;
  packages: { name: string; version: string; tarball: string; sha256: string }[];
  publish_order: string[];
}

export interface IdentityInput {
  version: string;
  git_sha: string;
  git_tree: string;
  package_manager: string;
  node_version: string;
  platform: string;
  publish_order: string[];
  packages: { name: string; version: string; tarball: string; sha256: string }[];
}

const NON_DETERMINISTIC_KEYS = [
  "generated_at",
  "timestamp",
  "created_at",
  "run_id",
  "hostname",
  "date",
  "now",
];

/** True when the version is a semver prerelease (contains `-`). */
export function isPrerelease(version: string): boolean {
  return version.includes("-");
}

/**
 * Dist-tag policy (do NOT auto-repair registry tags):
 *   - prerelease → `next`
 *   - stable     → `latest`
 */
export function distTagForVersion(version: string): "next" | "latest" {
  return isPrerelease(version) ? "next" : "latest";
}

/**
 * Reject wrong tag/version pairing (stage path).
 * Prerelease must not stage as `latest`; stable must not stage as `next`.
 */
export function assertVersionTagPairing(version: string, tag: string): void {
  const expected = distTagForVersion(version);
  if (tag !== expected) {
    throw new Error(
      `refusing tag/version pairing: version ${version} requires --tag ${expected}, got ${tag}`,
    );
  }
}

export function stagePublishCommand(tarball: string, version: string): string {
  const tag = distTagForVersion(version);
  assertVersionTagPairing(version, tag);
  return (
    `npm stage publish ${tarball} --access public --tag ${tag} --registry ${CANONICAL_REGISTRY}`
  );
}

export function buildReleaseIdentity(input: IdentityInput): ReleaseIdentity {
  if (input.packages.length !== EXPECTED_PACKAGE_COUNT) {
    throw new Error(
      `identity: expected ${EXPECTED_PACKAGE_COUNT} packages, got ${input.packages.length}`,
    );
  }
  const versions = new Set(input.packages.map((p) => p.version));
  if (versions.size !== 1 || !versions.has(input.version)) {
    throw new Error(
      `identity: lockstep violation (identity.version=${input.version}, packages=${[...versions].join(",")})`,
    );
  }
  for (const name of input.publish_order) {
    if (!input.packages.some((p) => p.name === name)) {
      throw new Error(`identity: publish_order references unknown package ${name}`);
    }
  }
  return {
    version: input.version,
    git_sha: input.git_sha,
    git_tree: input.git_tree,
    package_manager: input.package_manager,
    node_version: input.node_version,
    platform: input.platform,
    publish_order: [...input.publish_order],
    packages: input.packages.map((p) => ({
      name: p.name,
      version: p.version,
      tarball: p.tarball.startsWith("tarballs/") ? p.tarball : `tarballs/${basename(p.tarball)}`,
      sha256: p.sha256,
    })),
  };
}

/** Guard: identity objects must not grow non-deterministic fields. */
export function assertDeterministicIdentity(identity: Record<string, unknown>): void {
  for (const key of Object.keys(identity)) {
    if (NON_DETERMINISTIC_KEYS.includes(key.toLowerCase())) {
      throw new Error(`identity must not include non-deterministic field ${key}`);
    }
  }
  const serialized = JSON.stringify(identity);
  for (const bad of NON_DETERMINISTIC_KEYS) {
    if (new RegExp(`"${bad}"\\s*:`, "i").test(serialized)) {
      throw new Error(`identity JSON must not contain ${bad}`);
    }
  }
}

export function node20ConsumerPackages(
  names: readonly string[] = PUBLIC_PACKAGE_NAMES,
): string[] {
  return names.filter((n) => !(NODE20_CONSUMER_EXCLUDES as readonly string[]).includes(n));
}
