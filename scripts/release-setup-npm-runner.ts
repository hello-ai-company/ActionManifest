/**
 * Exact pinned npm CLI runner for release:setup.
 *
 * Host `npm` (often 10.x) must NOT determine Trusted Publisher / security
 * correctness. This module always selects npm@PINNED_NPM_CLI (11.15.0).
 *
 * Resolution order (never a floating latest spec, never a silent global replace):
 *   1. ACTIONMANIFEST_NPM_CLI — project-provided binary, must --version exact
 *   2. <repo>/.release-tools/npm-cli/<version>/  (local cache; gitignored)
 *   3. <repo>/node_modules/npm  when that package is exactly the pin
 *   4. npx --yes --package=npm@<pin>  (documented download into the npx cache)
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PINNED_NPM_CLI } from "./release-identity.js";

export const PINNED_NPM_PACKAGE_SPEC = `npm@${PINNED_NPM_CLI}` as const;

export type PinnedNpmSource = "env" | "project-local" | "node_modules" | "npx-exact";

export interface PinnedNpmResolution {
  command: string;
  argvPrefix: string[];
  version: string;
  source: PinnedNpmSource;
  spec: typeof PINNED_NPM_PACKAGE_SPEC;
}

const defaultRepoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function readNpmPackageVersion(packageJsonPath: string): string | null {
  if (!existsSync(packageJsonPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function projectLocalBin(repoRoot: string, version: string): string | null {
  const candidates = [
    join(repoRoot, ".release-tools", "npm-cli", version, "bin", "npm-cli.js"),
    join(repoRoot, ".release-tools", "npm-cli", version, "bin", "npm"),
  ];
  for (const bin of candidates) {
    if (existsSync(bin)) return bin;
  }
  const pkgVersion = readNpmPackageVersion(join(repoRoot, ".release-tools", "npm-cli", version, "package.json"));
  if (pkgVersion === version) {
    const js = join(repoRoot, ".release-tools", "npm-cli", version, "bin", "npm-cli.js");
    if (existsSync(js)) return js;
  }
  return null;
}

export function resolvePinnedNpm(opts?: {
  env?: NodeJS.ProcessEnv;
  repoRoot?: string;
  /** Diagnostic only — never used to select the binary. */
  hostNpmVersion?: string;
}): PinnedNpmResolution {
  const env = opts?.env ?? process.env;
  const repoRoot = opts?.repoRoot ?? defaultRepoRoot;
  const spec = PINNED_NPM_PACKAGE_SPEC;

  const fromEnv = env.ACTIONMANIFEST_NPM_CLI?.trim();
  if (fromEnv) {
    // Intended pin only. Live paths must assert `npm --version` === PINNED_NPM_CLI
    // before trust/access (see assertLivePinnedNpmBinary / inspectCli).
    return {
      command: fromEnv,
      argvPrefix: [],
      version: PINNED_NPM_CLI,
      source: "env",
      spec,
    };
  }

  const local = projectLocalBin(repoRoot, PINNED_NPM_CLI);
  if (local) {
    if (local.endsWith(".js")) {
      return {
        command: process.execPath,
        argvPrefix: [local],
        version: PINNED_NPM_CLI,
        source: "project-local",
        spec,
      };
    }
    return {
      command: local,
      argvPrefix: [],
      version: PINNED_NPM_CLI,
      source: "project-local",
      spec,
    };
  }

  const bundledPkg = join(repoRoot, "node_modules", "npm", "package.json");
  const bundledVersion = readNpmPackageVersion(bundledPkg);
  if (bundledVersion === PINNED_NPM_CLI) {
    const js = join(repoRoot, "node_modules", "npm", "bin", "npm-cli.js");
    if (existsSync(js)) {
      return {
        command: process.execPath,
        argvPrefix: [js],
        version: PINNED_NPM_CLI,
        source: "node_modules",
        spec,
      };
    }
  }

  return {
    command: "npx",
    argvPrefix: ["--yes", `--package=${spec}`, "--", "npm"],
    version: PINNED_NPM_CLI,
    source: "npx-exact",
    spec,
  };
}

export function pinnedNpmInvocation(
  userArgs: string[],
  resolution: PinnedNpmResolution = resolvePinnedNpm(),
): { command: string; args: string[] } {
  return {
    command: resolution.command,
    args: [...resolution.argvPrefix, ...userArgs],
  };
}

/** True when the selected spec is the exact pin (never a floating latest). */
export function isExactPinnedNpmSpec(spec: string): boolean {
  return spec === PINNED_NPM_PACKAGE_SPEC && !spec.includes("latest");
}
