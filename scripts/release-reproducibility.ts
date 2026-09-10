/**
 * release:reproducibility — prove that the same source tree produces
 * byte-identical release tarballs. Same tree → same bytes → same SHA-256.
 *
 * Root cause this gates (upstream pnpm/pnpm#10167): pnpm ≤ 10.x packed
 * workspace manifests with unstable dependency key ordering, so repeated
 * `pnpm pack` runs produced different tarball bytes. Fixed in pnpm 11.23.0
 * ("Packed workspace package manifests now preserve dependency order").
 *
 * The gate:
 *   - refuses to run on pnpm < 11.23.0 (exact pin enforced), so release
 *     artifacts can never be built by an older, non-deterministic pnpm;
 *   - packs every public package N times (default 10) into independent temp
 *     directories;
 *   - requires ALL runs to be byte-identical per package (SHA-256);
 *   - on mismatch, extracts package/package.json from the differing tarballs
 *     and diffs them as a DIAGNOSTIC only — the fix is never a semantic or
 *     canonicalized hash; the tarball bytes themselves must match.
 *
 * Usage:
 *   pnpm release:reproducibility            # 10 runs (release gate)
 *   pnpm release:reproducibility --runs 2   # quick CI path
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

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

/** The first pnpm with the deterministic packed-manifest fix (upstream #10167). */
export const MIN_DETERMINISTIC_PNPM = "11.23.0";

/** Pure: group per-run hashes by package and report distinct-hash counts. */
export function distinctHashCounts(
  hashes: Map<string, string[]>,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [pkg, list] of hashes) {
    out.set(pkg, new Set(list).size);
  }
  return out;
}

/** Pure: extract dependency key order from a packed manifest JSON string. */
export function dependencyKeyOrder(packedManifestJson: string): string[] {
  const parsed = JSON.parse(packedManifestJson) as { dependencies?: Record<string, unknown> };
  return Object.keys(parsed.dependencies ?? {});
}

export function fail(message: string): never {
  console.error(`release:reproducibility FAIL: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

export function semverAtLeast(v: string, min: string): boolean {
  const pa = v.split(".").map(Number);
  const pb = min.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return true;
}

function main(): void {
// ---------- pnpm version guard ----------
const pnpmVersion = run("pnpm", ["--version"], root);
if (semverAtLeast(pnpmVersion, MIN_DETERMINISTIC_PNPM) === false) {
  fail(
    `pnpm ${pnpmVersion} cannot produce deterministic release artifacts (upstream #10167). ` +
      `Release artifacts require pnpm >= ${MIN_DETERMINISTIC_PNPM} (pinned: ${MIN_DETERMINISTIC_PNPM}).`,
  );
}
if (pnpmVersion !== MIN_DETERMINISTIC_PNPM) {
  console.warn(
    `release:reproducibility WARN: running on pnpm ${pnpmVersion}; the pinned release toolchain is ${MIN_DETERMINISTIC_PNPM}. ` +
      `Never build release artifacts with a different pnpm version.`,
  );
}

// ---------- repeated independent packs ----------
const runsArg = process.argv.find((a) => a.startsWith("--runs"));
const RUNS = runsArg ? Number(runsArg.split("=")[1] ?? process.argv[process.argv.indexOf(runsArg) + 1]) : 10;
if (!Number.isInteger(RUNS) || RUNS < 2) {
  fail("--runs must be an integer >= 2");
}

const work = mkdtempSync(join(tmpdir(), "actionmanifest-repro-"));
try {
  // Pack every package RUNS times, each run into its own directory.
  const hashes = new Map<string, string[]>(); // package name -> sha per run
  for (let r = 1; r <= RUNS; r++) {
    const outDir = join(work, `run-${String(r).padStart(2, "0")}`);
    mkdirSync(outDir, { recursive: true });
    for (const dir of PUBLIC_PACKAGE_DIRS) {
      run("pnpm", ["pack", "--pack-destination", outDir], join(root, dir));
    }
    for (const file of readdirSync(outDir).filter((f) => f.endsWith(".tgz"))) {
      const pkgName = `@actionmanifest/${file.replace(/^actionmanifest-/, "").replace(/-\d.*\.tgz$/, "")}`;
      const list = hashes.get(pkgName) ?? [];
      list.push(sha256File(join(outDir, file)));
      hashes.set(pkgName, list);
    }
  }

  let allOk = true;
  for (const dir of PUBLIC_PACKAGE_DIRS) {
    const pkgName = `@actionmanifest/${dir.split("/")[1]}`;
    const list = hashes.get(pkgName) ?? [];
    if (list.length !== RUNS) {
      fail(`${pkgName}: expected ${RUNS} packs, got ${list.length}`);
    }
    const unique = [...new Set(list)];
    if (unique.length !== 1) {
      allOk = false;
      console.error(`\n✗ ${pkgName}: ${unique.length} distinct hashes across ${RUNS} runs`);
      // Diagnostic ONLY: show why the bytes differ (e.g. dependency key order).
      // The fix is never a semantic hash — tarball bytes must match.
      const firstHash = list[0]!;
      const divergent = list.findIndex((h) => h !== firstHash);
      const a = extractManifest(join(work, `run-01`, tgzName(outDirName(work, 1), pkgName)));
      const b = extractManifest(join(work, `run-${String(divergent + 1).padStart(2, "0")}`, tgzName(outDirName(work, divergent + 1), pkgName)));
      console.error("  --- packed package.json (run 1) ---");
      console.error(a.trim());
      console.error(`  --- packed package.json (run ${divergent + 1}) ---`);
      console.error(b.trim());
    } else {
      console.log(`${pkgName}\n  ${RUNS}/${RUNS} identical  sha256 ${unique[0]!.slice(0, 12)}…`);
    }
  }

  if (!allOk) {
    fail("non-deterministic pack output detected — see diagnostics above");
  }
  console.log(
    `\nREPRODUCIBLE — ${PUBLIC_PACKAGE_DIRS.length} packages × ${RUNS} runs, byte-identical per package (pnpm ${pnpmVersion})`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}

function outDirName(base: string, run: number): string {
  return join(base, `run-${String(run).padStart(2, "0")}`);
}

function tgzName(dir: string, pkgName: string): string {
  const short = pkgName.split("/")[1]!;
  const file = readdirSync(dir).find((f) => f.startsWith(`actionmanifest-${short}-`) && f.endsWith(".tgz"));
  if (!file) fail(`tarball for ${pkgName} missing in ${dir}`);
  return file;
}

function extractManifest(tgzPath: string): string {
  return execFileSync("tar", ["-xzf", tgzPath, "-O", "package/package.json"], { encoding: "utf8" });
}
}

// Main-module guard: importing this file (e.g. from tests) runs nothing.
const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main();
}
