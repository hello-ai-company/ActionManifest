/**
 * Governance guards (Phase 2.1 final hardening).
 *
 * Immutable means governance-enforced, not checksum-self-declared:
 *
 * 1. Frozen schema guard — the published v0.1/v0.2 manifest schemas MUST NOT
 *    change in a PR/push diff. Unlike checksums.json (which detects local
 *    corruption but can be "updated" to bless a change), this guard compares
 *    against the base ref and cannot be bypassed by editing a pin file.
 *    checksums.json remains for working-tree corruption detection and release
 *    artifact integrity.
 *
 * 2. Suite version guard — normative conformance contents
 *    (conformance/vectors/**, conformance/schema/**, conformance/manifest.json)
 *    changed ⇒ suite_version MUST change. Reference-serialization goldens are
 *    explicitly NOT normative (TypeScript regression only) and do not require
 *    a suite version bump.
 *
 * The path-classification logic is pure and unit-tested; git plumbing is
 * isolated in main().
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const FROZEN_SCHEMA_PREFIXES = [
  "packages/schema/schemas/v0.1/",
  "packages/schema/schemas/v0.2/",
] as const;

export const NORMATIVE_CONFORMANCE_PREFIXES = [
  "conformance/vectors/",
  "conformance/schema/",
  "conformance/manifest.json",
] as const;

/** Reference-implementation regression data is not part of the universal suite. */
export const REFERENCE_ONLY_PREFIXES = [
  "conformance/vectors/reference-serialization/",
] as const;

export function isFrozenSchemaPath(path: string): boolean {
  return FROZEN_SCHEMA_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isNormativeConformancePath(path: string): boolean {
  if (REFERENCE_ONLY_PREFIXES.some((prefix) => path.startsWith(prefix))) return false;
  return NORMATIVE_CONFORMANCE_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(prefix),
  );
}

/** Frozen schema files that were modified in the diff. */
export function findFrozenViolations(changedPaths: string[]): string[] {
  return changedPaths.filter(isFrozenSchemaPath);
}

/**
 * Returns a violation message when normative conformance contents changed
 * without a suite_version bump; undefined when the change is allowed.
 */
export function findSuiteVersionViolation(
  changedPaths: string[],
  baseSuiteVersion: string | undefined,
  headSuiteVersion: string,
): string | undefined {
  const normativeChanged = changedPaths.some(isNormativeConformancePath);
  if (!normativeChanged) return undefined;
  if (baseSuiteVersion === undefined) return undefined; // suite introduced in this diff
  if (baseSuiteVersion === headSuiteVersion) {
    return `normative conformance contents changed (${changedPaths
      .filter(isNormativeConformancePath)
      .slice(0, 3)
      .join(", ")}…) but suite_version is unchanged (${headSuiteVersion}). Bump it per docs/COMPATIBILITY.md.`;
  }
  return undefined;
}

// ---------- git plumbing (CI entry point) ----------

function git(args: string[]): string {
  const r = spawnSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (r.status !== 0) {
    throw new Error(r.stderr.trim() || `git ${args.join(" ")} exited ${r.status}`);
  }
  return r.stdout.trim();
}

function resolveBase(): string | undefined {
  const explicit = process.env.GOVERNANCE_BASE_SHA;
  if (explicit && !/^0+$/.test(explicit)) return explicit;
  try {
    git(["rev-parse", "--verify", "origin/main"]);
    return "origin/main";
  } catch {
    return undefined;
  }
}

function main(): void {
  const base = resolveBase();
  if (!base) {
    console.log("governance: no base ref available; skipping (local bootstrap)");
    return;
  }

  // Committed diff (CI: PR head vs base) ∪ working-tree diff (local runs) ∪
  // untracked files — a frozen edit must be caught before it is even committed.
  let committed: string[];
  try {
    committed = git(["diff", "--name-only", `${base}...HEAD`]).split("\n").filter(Boolean);
  } catch {
    committed = git(["diff", "--name-only", `${base}`, "HEAD"]).split("\n").filter(Boolean);
  }
  const worktree = git(["diff", "--name-only", base]).split("\n").filter(Boolean);
  const untracked = git(["ls-files", "--others", "--exclude-standard"])
    .split("\n")
    .filter(Boolean);
  const changed = [...new Set([...committed, ...worktree, ...untracked])];

  const failures: string[] = [];

  const frozen = findFrozenViolations(changed);
  if (frozen.length > 0) {
    failures.push(
      `frozen schema files modified (immutable — ship a new schema_version instead):\n  ${frozen.join("\n  ")}`,
    );
  }

  let baseSuiteVersion: string | undefined;
  try {
    const raw = git(["show", `${base}:conformance/manifest.json`]);
    baseSuiteVersion = (JSON.parse(raw) as { suite_version?: string }).suite_version;
  } catch {
    baseSuiteVersion = undefined; // suite introduced in this diff
  }
  let headSuiteVersion = "0.0.0";
  try {
    headSuiteVersion = (
      JSON.parse(readFileSync("conformance/manifest.json", "utf8")) as { suite_version: string }
    ).suite_version;
  } catch {
    failures.push("conformance/manifest.json missing or unreadable at HEAD");
  }
  const suiteViolation = findSuiteVersionViolation(changed, baseSuiteVersion, headSuiteVersion);
  if (suiteViolation) failures.push(suiteViolation);

  if (failures.length > 0) {
    console.error(`governance: FAIL\n${failures.map((f) => `- ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log(
    `governance: PASS (base ${base}; ${changed.length} changed path(s); frozen schemas intact; suite_version ${headSuiteVersion})`,
  );
}

// Run only when executed directly (not when imported by tests).
const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main();
}
