/**
 * cli-install-smoke — prove a packed @actionmanifest/cli tarball installs and
 * runs like a real third-party install.
 *
 * Fresh project → `pnpm install --offline` of the CLI tarball with every
 * internal @actionmanifest/* dependency redirected to the local tarballs via
 * pnpm overrides (external deps come from the local pnpm store; no network) →
 * the `actionman` bin shim is exercised from a foreign cwd with NO repository
 * checkout: --version/--help, extract/validate --json purity, the bundled
 * conformance suite, the bundled benchmark corpus, distinct exit codes, and
 * no @xberg-io in the installed tree.
 *
 * Shared by scripts/pack-check.ts (PR gate) and scripts/release-dry-run.ts
 * (release artifact verification) so the install proof is never duplicated.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, statSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface CliSmokeInput {
  /** Absolute path to the packed actionmanifest-cli-*.tgz */
  cliTarball: string;
  /** Expected CLI version (from the packed package.json). */
  expectedVersion: string;
  /** short name ("core") → absolute tarball path for every internal dep. */
  libraryTarballs: Map<string, string>;
  /** Expected total universal conformance vectors (guards against a partial bundle). */
  expectedConformanceTotal: number;
}

function fail(message: string): never {
  console.error(`cli-install-smoke FAIL: ${message}`);
  process.exit(1);
}

function run(cmd: string, args: string[], cwd: string): string {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    fail(
      `${cmd} ${args.join(" ")} exited ${r.status}: ${(r.stderr ?? "").trim() || (r.stdout ?? "").trim()}`,
    );
  }
  return r.stdout ?? "";
}

function probe(
  cmd: string,
  args: string[],
  cwd: string,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

export function cliInstallSmoke(input: CliSmokeInput): void {
  const work = mkdtempSync(join(tmpdir(), "actionman-install-smoke-"));
  try {
    const overrides: Record<string, string> = {};
    for (const [name, tgz] of input.libraryTarballs) {
      overrides[`@actionmanifest/${name}`] = `file:${tgz}`;
    }
    writeFileSync(
      join(work, "package.json"),
      JSON.stringify(
        {
          name: "actionman-cli-consumer-smoke",
          private: true,
          type: "module",
          // Pin the package manager so the smoke is deterministic across
          // environments (corepack provisions exactly this pnpm).
          packageManager: "pnpm@10.14.0",
          dependencies: { "@actionmanifest/cli": `file:${input.cliTarball}` },
        },
        null,
        2,
      ),
      "utf8",
    );
    // Overrides live in pnpm-workspace.yaml — the supported settings home in
    // pnpm 10+ (the package.json "pnpm" field is ignored by newer pnpm).
    const overridesYaml =
      "overrides:\n" +
      Object.entries(overrides)
        .map(([name, spec]) => `  ${JSON.stringify(name)}: ${JSON.stringify(spec)}`)
        .join("\n") +
      "\n";
    writeFileSync(join(work, "pnpm-workspace.yaml"), overridesYaml, "utf8");

    // Install offline-first: every @actionmanifest/* package always resolves
    // from the local tarballs via the overrides above — never from a registry.
    // External deps (commander/ajv/…) come from the local pnpm store. A cold
    // CI runner restores the store but not the packument metadata cache, so
    // version *resolution* may need the network there; fall back to
    // --prefer-offline (store tarballs still win; only metadata may be fetched).
    const offline = probe("pnpm", ["install", "--offline", "--ignore-scripts"], work);
    if (offline.status !== 0) {
      console.log("  … offline install unavailable (cold metadata cache); retrying --prefer-offline");
      run("pnpm", ["install", "--prefer-offline", "--ignore-scripts"], work);
    }

    const bin = join(work, "node_modules", ".bin", "actionman");
    if (!existsSync(bin)) fail("node_modules/.bin/actionman was not created by install");
    if ((statSync(bin).mode & 0o111) === 0) fail("bin shim is not executable");

    const version = probe(bin, ["--version"], work);
    if (version.status !== 0 || version.stdout.trim() !== input.expectedVersion) {
      fail(
        `--version failed or mismatched (status ${version.status}, got ${JSON.stringify(version.stdout)})`,
      );
    }

    const help = probe(bin, ["--help"], work);
    if (help.status !== 0 || !help.stdout.includes("Usage: actionman")) {
      fail("--help did not print usage");
    }

    // Data on stdout must be pure JSON when --json is passed.
    writeFileSync(
      join(work, "sample.txt"),
      "令和8年10月15日に秋の遠足を実施します。雨天の場合は10月22日に延期します。",
      "utf8",
    );
    const extract = probe(bin, ["extract", "sample.txt", "--json"], work);
    if (extract.status !== 0) fail(`extract failed: ${extract.stderr}`);
    try {
      JSON.parse(extract.stdout) as unknown;
    } catch {
      fail("extract --json stdout is not pure JSON");
    }
    if (extract.stderr.trim() !== "") fail("extract wrote to stderr on success");

    writeFileSync(join(work, "manifest.json"), extract.stdout, "utf8");
    const validate = probe(bin, ["validate", "manifest.json", "--doc", "sample.txt", "--json"], work);
    if (validate.status !== 0) fail(`validate failed: ${validate.stderr}`);
    const validateReport = JSON.parse(validate.stdout) as { ok?: boolean };
    if (validateReport.ok !== true) fail("validate --json did not report ok");

    // Bundled conformance suite: runs with no repo checkout, from a foreign cwd.
    const conformance = probe(bin, ["conformance", "--json"], work);
    if (conformance.status !== 0) {
      fail(`bundled conformance failed (status ${conformance.status}): ${conformance.stderr}`);
    }
    const report = JSON.parse(conformance.stdout) as {
      result?: string;
      totals?: { passed: number; total: number };
      critical_false_exported?: number;
    };
    if (
      report.result !== "conformant" ||
      report.totals?.passed !== report.totals?.total ||
      report.totals?.total !== input.expectedConformanceTotal
    ) {
      fail(
        `bundled conformance not fully conformant (got ${report.totals?.passed}/${report.totals?.total}, expected ${input.expectedConformanceTotal})`,
      );
    }
    if ((report.critical_false_exported ?? 1) !== 0) {
      fail("critical false exported must be 0");
    }

    // Bundled benchmark corpus works out of the box too.
    const benchmark = probe(bin, ["benchmark", "--smoke"], work);
    if (benchmark.status !== 0) fail(`bundled benchmark --smoke failed: ${benchmark.stderr}`);

    // Error paths: distinct exit codes, errors on stderr (not stdout).
    const missing = probe(bin, ["validate", "does-not-exist.json"], work);
    if (missing.status !== 1 || missing.stdout.trim() !== "" || missing.stderr.trim() === "") {
      fail("missing-file validate must exit 1 with the error on stderr only");
    }
    const badRoot = probe(bin, ["conformance", "--root", "/nonexistent-suite"], work);
    if (badRoot.status !== 2) fail("bad --root must exit 2 (runner/config error)");

    // The CLI must not install the native Xberg binding by default.
    if (existsSync(join(work, "node_modules", "@xberg-io"))) {
      fail("install pulled in @xberg-io/* — native dependency must stay opt-in");
    }

    console.log(
      "  ✓ @actionmanifest/cli installed from tarball (offline, foreign cwd): bin shim, extract/validate/conformance/benchmark, exit codes, no Xberg — OK",
    );
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
