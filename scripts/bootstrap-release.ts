/**
 * bootstrap:check — prepare / consume canonical release artifacts.
 *
 * DRY RUN ONLY. This script NEVER publishes, NEVER stages, NEVER approves,
 * NEVER creates tags or GitHub Releases, and NEVER touches npm authentication.
 *
 * Modes:
 *   pnpm bootstrap:check --prepare
 *     Local NON-CANONICAL pack via release:dry-run. Allowed on feature
 *     branches and dirty trees. Artifacts are operator-machine bytes —
 *     never publish them.
 *   pnpm bootstrap:check --publish-ready
 *     NO local pack / dry-run / pack. Resolves exact-head CI + Release
 *     Check, downloads release-check-<sha>, verifies SHA256SUMS + manifest
 *     + 10 tarballs + publish_order, and writes a plan that points at those
 *     downloaded files. Requires clean tree, main, HEAD == origin/main.
 *
 * 0.9.0-rc.0 bootstrap is COMPLETE. --publish-ready does not require a
 * registry 404 and must not be used to republish rc.0.
 *
 * Exit codes: 0 = ready (mode-dependent), 1 = NOT READY, 2 = BLOCKED/UNKNOWN.
 */
import { execFileSync, spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPECTED_BOOTSTRAP_VERSION,
  buildBootstrapPlan,
  buildCanonicalReleasePlan,
  publishReadinessIssues,
  type ReleaseManifestLike,
} from "./bootstrap-plan.js";
import { verifyCanonicalArtifactLayout } from "./canonical-artifact.js";
import {
  FULL_RELEASE_CHECK_NOT_FOUND,
  pickReleaseGates,
} from "./full-release-check.mjs";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import { verifyPackagesOnRegistry } from "./registry-truth.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "release-artifacts");

export function fail(message: string, code = 1): never {
  console.error(`bootstrap:check ${code === 2 ? "BLOCKED" : "NOT READY"}: ${message}`);
  process.exit(code);
}

function run(cmd: string, args: string[], cwd: string): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
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
 * exact commit has SUCCESS on BOTH required workflows.
 */
export function checkExactHeadGates(head: string): { error?: string; releaseCheckRunId?: string } {
  const repoProbe = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (repoProbe.status !== 0) {
    return { error: "cannot resolve the GitHub repository via `gh` (missing or unauthenticated) — CI gates UNKNOWN" };
  }
  const repo = repoProbe.stdout.trim();
  const r = spawnSync(
    "gh",
    ["api", `repos/${repo}/actions/runs?head_sha=${head}&per_page=100`],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (r.status !== 0) {
    return { error: `cannot read workflow runs on ${head} — CI gates UNKNOWN` };
  }
  let payload: { workflow_runs?: unknown[] };
  try {
    payload = JSON.parse(r.stdout) as { workflow_runs?: unknown[] };
  } catch {
    return { error: "cannot parse workflow-run list — CI gates UNKNOWN" };
  }
  const runs = Array.isArray(payload.workflow_runs) ? payload.workflow_runs : [];
  const { ci, releaseCheck } = pickReleaseGates(
    runs as Parameters<typeof pickReleaseGates>[0],
    head,
  );
  if (!ci) {
    return { error: `CI on exact HEAD ${head.slice(0, 12)}… is not success` };
  }
  if (!releaseCheck) {
    return { error: FULL_RELEASE_CHECK_NOT_FOUND };
  }
  return { releaseCheckRunId: String(releaseCheck.id) };
}

/** Download release-check-<sha> into dest. No pack. */
export function downloadReleaseCheckArtifact(runId: string, head: string, dest: string): string | undefined {
  mkdirSync(dest, { recursive: true });
  const artifactName = `release-check-${head}`;
  const dl = spawnSync("gh", ["run", "download", runId, "-n", artifactName, "-D", dest], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (dl.status !== 0) {
    return `cannot download canonical Release Check artifact ${artifactName} from run ${runId} — ${dl.stderr.trim() || "UNAVAILABLE"}`;
  }
  return undefined;
}

function copyArtifactToOutDir(artifactRoot: string): void {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });
  cpSync(artifactRoot, outDir, { recursive: true });
}

function readManifestFrom(dir: string): ReleaseManifestLike {
  const manifestPath = join(dir, "release-manifest.json");
  if (!existsSync(manifestPath)) {
    fail(`release-manifest.json missing under ${dir}`);
  }
  return JSON.parse(readFileSync(manifestPath, "utf8")) as ReleaseManifestLike;
}

function assertLockstepVersion(manifest: ReleaseManifestLike): void {
  const byName = new Map(manifest.packages.map((p) => [p.name, p]));
  for (const name of PUBLIC_PACKAGE_NAMES) {
    const entry = byName.get(name);
    if (!entry) fail(`expected package ${name} missing from release manifest`);
    if (entry.version !== EXPECTED_BOOTSTRAP_VERSION) {
      fail(
        `version gate: ${name} is ${entry.version}, expected ${EXPECTED_BOOTSTRAP_VERSION} (lockstep; this phase does not bump off rc.0)`,
      );
    }
  }
  console.log(`  ✓ version gate: all ${PUBLIC_PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}`);
}

function reportRegistryTruth(version: string): void {
  console.log("bootstrap:check — registry READ (truth first; timeout ≠ publish failure)…");
  const canonicalSha256 = new Map<string, string>();
  const { reports, overall } = verifyPackagesOnRegistry(PUBLIC_PACKAGE_NAMES, {
    version,
    canonicalSha256,
    retries: 3,
    timeoutMs: 15_000,
  });
  for (const r of reports) {
    console.log(`  ${r.name}@${r.version}: ${r.state}${r.notes[0] ? ` — ${r.notes[0]}` : ""}`);
  }
  if (overall === "UNKNOWN") {
    fail(
      "registry READ could not be completed (timeout/network). This is NOT a publish failure — do not republish. Retry the read.",
      2,
    );
  }
}

/**
 * --prepare: local NON-CANONICAL pack is allowed. Isolated so tests can
 * assert that --publish-ready never calls this.
 */
export function runPreparePack(): void {
  console.log("bootstrap:check — --prepare: local NON-CANONICAL release:dry-run (not the publish artifact)…");
  execFileSync("pnpm", ["release:dry-run"], { cwd: root, stdio: "inherit" });
}

/**
 * --publish-ready body: download + verify only. MUST NOT pack / dry-run.
 */
export function runPublishReadyConsume(head: string, runId: string): string {
  const tmp = mkdtempSync(join(tmpdir(), "actionmanifest-canonical-"));
  try {
    const dlErr = downloadReleaseCheckArtifact(runId, head, tmp);
    if (dlErr) fail(dlErr, 2);
    const { artifact, issues } = verifyCanonicalArtifactLayout(tmp, head);
    if (issues.length > 0) {
      fail(`canonical artifact verification failed:\n  - ${issues.map((i) => i.message).join("\n  - ")}`);
    }
    copyArtifactToOutDir(artifact.root);
    console.log(
      `  ✓ canonical artifact: ${artifact.tarballs.length} tarballs, SHA256SUMS, manifest, publish_order (run ${runId})`,
    );
    return outDir;
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

function main(): void {
  const args = process.argv.slice(2);
  const publishReadyMode = args.includes("--publish-ready");
  const prepareMode = args.includes("--prepare") || !publishReadyMode;
  if (!prepareMode && !publishReadyMode) {
    fail("unknown mode — use --prepare or --publish-ready", 2);
  }

  if (args.some((a) => /publish/i.test(a) && a !== "--publish-ready")) {
    fail("refusing to run: argv contains 'publish'. This script plans; it never publishes or stages.", 2);
  }
  for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (process.env[tokenVar]) {
      fail(`${tokenVar} is present — bootstrap preparation is credential-free. Unset it.`, 2);
    }
  }

  let git = gitState();
  let manifest: ReleaseManifestLike;

  if (publishReadyMode) {
    console.log("bootstrap:check — fetching fresh origin/main before comparison…");
    try {
      run("git", ["fetch", "origin", "main", "--prune"], root);
    } catch {
      fail("git fetch origin main failed — remote state UNKNOWN, refusing to proceed", 2);
    }
    git = gitState();
    const issues = publishReadinessIssues(git);
    if (issues.length > 0) {
      fail(`publish-readiness gate failed:\n  - ${issues.join("\n  - ")}`);
    }
    console.log("  ✓ publish-readiness: clean tree, on main, HEAD == freshly fetched origin/main");
    const gates = checkExactHeadGates(git.head);
    if (gates.error) {
      fail(`exact-head CI gate failed: ${gates.error}`, 2);
    }
    if (!gates.releaseCheckRunId) {
      fail("Release Check run id unavailable — canonical artifact UNAVAILABLE", 2);
    }
    console.log("  ✓ exact-head gates: CI + Release Check SUCCESS on the exact commit");
    runPublishReadyConsume(git.head, gates.releaseCheckRunId);
    manifest = readManifestFrom(outDir);
    assertLockstepVersion(manifest);
    reportRegistryTruth(EXPECTED_BOOTSTRAP_VERSION);
  } else {
    runPreparePack();
    manifest = readManifestFrom(outDir);
    assertLockstepVersion(manifest);
    reportRegistryTruth(EXPECTED_BOOTSTRAP_VERSION);
    console.log(
      `  i prepare mode: git state recorded but not enforced (branch=${git.branch}, dirty=${git.dirty}). Artifacts are NON-CANONICAL.`,
    );
  }

  const plan = publishReadyMode
    ? buildCanonicalReleasePlan(manifest, git, "release-artifacts/")
    : buildBootstrapPlan(manifest, git);
  writeFileSync(join(outDir, "bootstrap-plan.json"), JSON.stringify(plan, null, 2) + "\n", "utf8");

  console.log("\nPlan commands (DRY RUN — this script never executes them):");
  for (const p of plan.packages) {
    console.log(`  # ${p.name}@${p.version} (sha256 ${p.sha256.slice(0, 12)}…)`);
    if (publishReadyMode) {
      console.log(`  ${p.stage_command}`);
    } else {
      console.log(`  ${p.publish_command}`);
    }
  }
  console.log(`\nPlan written: ${join(outDir, "bootstrap-plan.json")}`);
  console.log(`  artifact_source: ${plan.artifact_source}`);
  if (publishReadyMode) {
    console.log(
      `bootstrap:check CANONICAL ARTIFACTS VERIFIED — ${PUBLIC_PACKAGE_NAMES.length} packages at ${EXPECTED_BOOTSTRAP_VERSION}, plan points at downloaded Release Check files. ` +
        `0.9.0-rc.0 bootstrap is COMPLETE; do not republish. Subsequent versions use release.yml mode=stage.`,
    );
  } else {
    console.log(
      `bootstrap:check PREPARE OK — local NON-CANONICAL artifacts at ${EXPECTED_BOOTSTRAP_VERSION}. ` +
        `Run 'pnpm bootstrap:check --publish-ready' on clean reviewed main to consume the exact-head Release Check artifact.`,
    );
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
