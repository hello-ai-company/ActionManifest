/**
 * bootstrap:check — Phase 2.4A first-release bootstrap preparation.
 *
 * DRY RUN ONLY. This script NEVER publishes, NEVER creates tags or GitHub
 * Releases, and NEVER touches npm authentication. It prepares and verifies
 * everything a maintainer needs for the manual, 2FA-protected bootstrap
 * publish of 0.9.0-rc.0 (docs/RELEASING.md §"First-ever publish").
 *
 * Modes:
 *   pnpm bootstrap:check              (same as --prepare)
 *   pnpm bootstrap:check --prepare    CI/dev preparation: pack + verify +
 *                                     registry preflight + plan. Allowed on
 *                                     feature branches and dirty trees.
 *   pnpm bootstrap:check --publish-ready
 *                                     Pre-publish gate for the irreversible
 *                                     manual bootstrap: everything above PLUS
 *                                     clean tree, branch == main, HEAD ==
 *                                     origin/main. Only this mode may say
 *                                     "READY FOR MANUAL BOOTSTRAP".
 *
 * Pure logic (plan building, readiness policy) lives in
 * `bootstrap-plan.ts` — importable with zero side effects. This file is the
 * CLI entry point and only runs under a main-module guard.
 *
 * Exit codes: 0 = ready (mode-dependent), 1 = NOT READY (version / registry /
 * artifact / git-state mismatch), 2 = BLOCKED/UNKNOWN (preflight could not
 * be completed, e.g. network failure).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_BOOTSTRAP_VERSION,
  buildBootstrapPlan,
  publishReadinessIssues,
  type ReleaseManifestLike,
} from "./bootstrap-plan.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release-artifacts");

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

function gitState(): { head: string; branch: string; dirty: boolean; originMain: string } {
  return {
    head: run("git", ["rev-parse", "HEAD"], root),
    branch: run("git", ["rev-parse", "--abbrev-ref", "HEAD"], root),
    dirty: run("git", ["status", "--porcelain"], root).length > 0,
    originMain: run("git", ["rev-parse", "origin/main"], root),
  };
}

/**
 * Exact-head CI gates (publish-ready only). Verifies via GitHub that the
 * exact commit to be published has SUCCESS on BOTH required workflows.
 * Uses the maintainer's local `gh` authentication — never a stored token.
 * Any inability to verify (gh missing, unauthenticated, API error) is
 * BLOCKED, never assumed green.
 */
function checkExactHeadGates(head: string): string | undefined {
  const repoProbe = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (repoProbe.status !== 0) {
    return "cannot resolve the GitHub repository via `gh` (missing or unauthenticated) — CI gates UNKNOWN";
  }
  const repo = repoProbe.stdout.trim();
  for (const workflow of ["CI", "Release Check"]) {
    const r = spawnSync(
      "gh",
      [
        "api",
        `repos/${repo}/actions/runs?head_sha=${head}&per_page=100`,
        "--jq",
        `[.workflow_runs[] | select(.name == "${workflow}")] | if length == 0 then "missing" else .[0].conclusion end`,
      ],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    if (r.status !== 0) {
      return `cannot read workflow runs for ${workflow} on ${head} — CI gates UNKNOWN`;
    }
    const conclusion = r.stdout.trim();
    if (conclusion !== "success") {
      return `${workflow} on exact HEAD ${head.slice(0, 12)}… is "${conclusion}", not success`;
    }
  }
  return undefined;
}

function main(): void {
  const args = process.argv.slice(2);
  const publishReadyMode = args.includes("--publish-ready");
  const prepareMode = args.includes("--prepare") || !publishReadyMode;
  if (!prepareMode && !publishReadyMode) {
    fail("unknown mode — use --prepare or --publish-ready", 2);
  }

  // ---------- accidental-publish guard (fail closed) ----------
  if (args.some((a) => /publish/i.test(a) && a !== "--publish-ready")) {
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
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifestLike;

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
    console.log(`  ✓ ${name}: 404 (not published — as expected)`);
  }

  // ---------- 4. publish-readiness gate (mode-dependent) ----------
  if (publishReadyMode) {
    // Fresh remote truth: never compare against a stale local tracking ref.
    console.log("bootstrap:check — fetching fresh origin/main before comparison…");
    try {
      run("git", ["fetch", "origin", "main", "--prune"], root);
    } catch {
      fail("git fetch origin main failed — remote state UNKNOWN, refusing to proceed", 2);
    }
  }
  const git = gitState();
  if (publishReadyMode) {
    const issues = publishReadinessIssues(git);
    if (issues.length > 0) {
      fail(`publish-readiness gate failed:\n  - ${issues.join("\n  - ")}`);
    }
    console.log("  ✓ publish-readiness: clean tree, on main, HEAD == freshly fetched origin/main");
    const gateIssue = checkExactHeadGates(git.head);
    if (gateIssue) {
      fail(`exact-head CI gate failed: ${gateIssue}`, 2);
    }
    console.log("  ✓ exact-head gates: CI + Release Check SUCCESS on the exact commit to publish");
  } else {
    console.log(
      `  i prepare mode: git state recorded but not enforced (branch=${git.branch}, dirty=${git.dirty})`,
    );
  }

  // ---------- 5. bootstrap plan ----------
  const plan = buildBootstrapPlan(manifest, git);
  writeFileSync(join(outDir, "bootstrap-plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

  // ---------- 6. print the manual plan ----------
  console.log("\nManual bootstrap publish commands (MAINTAINER ONLY — 2FA, reviewed tarballs):");
  for (const p of plan.packages) {
    console.log(`  # ${p.name}@${p.version} (sha256 ${p.sha256.slice(0, 12)}…)`);
    console.log(`  ${p.publish_command}`);
  }
  console.log(`\nPlan written: ${join(outDir, "bootstrap-plan.json")}`);
  if (publishReadyMode) {
    console.log(
      `bootstrap:check READY FOR MANUAL BOOTSTRAP — ${PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}, registry clear (all 404), clean reviewed main, artifacts verified.`,
    );
  } else {
    console.log(
      `bootstrap:check PREPARE OK — ${PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}, registry clear (all 404), artifacts verified. ` +
        `Run 'pnpm bootstrap:check --publish-ready' from a clean reviewed main before the manual publish.`,
    );
  }
}

// Main-module guard: importing this file (e.g. from tests) runs nothing.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
