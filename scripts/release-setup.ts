/**
 * release:setup — Release Control Plane controller.
 *
 *   pnpm release:setup --check   READ ONLY. Zero mutations.
 *   pnpm release:setup --apply   Explicit only. Print plan, then converge.
 *
 * DEFAULT DENY. READY last. No registry publish / staged publish / approve.
 * No release tag / GitHub Release / version bump. Human 2FA PoP is never automated.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import { GhControlPlaneClient, readOnlyGitHub, type GitHubControlPlaneClient } from "./release-setup-github.js";
import {
  OfficialNpmTrustClient,
  TRUSTED_PUBLISHER_WRITE_PACE_MS,
  readOnlyNpm,
  type NpmTrustClient,
} from "./release-setup-npm.js";
import {
  READY_VARIABLE_NAME,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  applyBlocked,
  assertNoSecrets,
  desiredControlPlane,
  evaluatePrerequisites,
  mutatingItems,
  planReleaseControlPlane,
  prerequisitesPass,
  redactSecrets,
  type ActualControlPlane,
  type PlanItem,
  type SetupMode,
  type SetupPlan,
  type SetupVerdict,
} from "./release-setup-plan.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_REPORT = join(root, "release-control-plane-report.json");

export interface SetupDeps {
  github: GitHubControlPlaneClient;
  npm: NpmTrustClient;
  readWorkflow: () => string;
  writeReport?: (report: ControlPlaneReport) => void;
  log: (line: string) => void;
  paceTrustedPublisherWrites?: (ms: number) => Promise<void>;
}

export interface ControlPlaneReport {
  kind: "actionmanifest-release-control-plane-report";
  mode: SetupMode;
  verdict: SetupVerdict;
  repo: typeof RELEASE_REPO_SLUG;
  packages: readonly string[];
  ready: { name: typeof READY_VARIABLE_NAME; value: string | null; last: true };
  mutations: { id: string; action: string; resource: string }[];
  items: PlanItem[];
  critical: string[];
  remaining_human: string[];
  registry_writes: string;
  notes: string[];
}

export interface SetupResult {
  mode: SetupMode;
  plan: SetupPlan;
  report: ControlPlaneReport;
  writes: string[];
  actual: ActualControlPlane;
}

function fail(message: string, code = 1): never {
  console.error(`release:setup ${code === 2 ? "BLOCKED" : "NOT READY"}: ${message}`);
  process.exit(code);
}

export function workflowReferencesNpmRelease(yaml: string): boolean {
  return /environment:\s*npm-release\b/.test(yaml);
}

export function defaultReadWorkflow(): string {
  return readFileSync(join(root, ".github/workflows/release.yml"), "utf8");
}

export async function discoverActual(deps: SetupDeps): Promise<ActualControlPlane> {
  const desired = desiredControlPlane();
  const repo = await deps.github.verifyRepo();
  const workflow = deps.readWorkflow();
  const environment = await deps.github.getEnvironment(RELEASE_ENVIRONMENT_NAME);
  const ruleset = await deps.github.listRulesets();
  const readyVariable = await deps.github.getVariable(READY_VARIABLE_NAME);
  const trustedPublishers = [];
  const packageSecurity = [];
  for (const name of desired.packages) {
    trustedPublishers.push(await deps.npm.listTrustedPublisher(name));
    packageSecurity.push(await deps.npm.getPackageSecurity(name));
  }
  return {
    repo,
    workflowReferencesEnvironment: workflowReferencesNpmRelease(workflow),
    environment,
    ruleset,
    readyVariable,
    trustedPublishers,
    packageSecurity,
  };
}

function printPlan(plan: SetupPlan, log: (line: string) => void): void {
  log(`release:setup plan (${plan.mode}) verdict=${plan.verdict}`);
  for (const item of plan.items) {
    const mutate = item.mutates ? " WRITE" : "";
    log(`  [${item.action}] ${item.resource} ${item.status}${mutate} — ${item.reason}`);
    if (item.diff) {
      for (const d of item.diff) log(`      diff: ${d}`);
    }
  }
  if (plan.critical.length > 0) {
    for (const c of plan.critical) log(`  !! ${c}`);
  }
  const writes = mutatingItems(plan);
  if (writes.length === 0) {
    log("  NO CHANGES REQUIRED");
  } else {
    log(`  planned writes (${writes.length}), READY last=${plan.readyLast}:`);
    for (const w of writes) log(`    ${w.order} ${w.action} ${w.resource}`);
  }
}

function buildReport(
  mode: SetupMode,
  plan: SetupPlan,
  actual: ActualControlPlane,
  writes: string[],
): ControlPlaneReport {
  const report: ControlPlaneReport = {
    kind: "actionmanifest-release-control-plane-report",
    mode,
    verdict: plan.verdict,
    repo: RELEASE_REPO_SLUG,
    packages: PUBLIC_PACKAGE_NAMES,
    ready: {
      name: READY_VARIABLE_NAME,
      value: actual.readyVariable.value,
      last: true,
    },
    mutations: writes.map((id) => {
      const item = plan.items.find((i) => i.id === id);
      return { id, action: item?.action ?? "UNKNOWN", resource: item?.resource ?? id };
    }),
    items: plan.items,
    critical: plan.critical,
    remaining_human: plan.remainingHuman,
    registry_writes:
      mode === "check"
        ? "none (check is read-only)"
        : writes.length === 0
          ? "none (idempotent — NO CHANGES REQUIRED)"
          : "approved control-plane settings only — no registry publish/stage/approve, no release tag, no GitHub Release",
    notes: [
      ...plan.notes,
      `unrelated environments/rulesets preserved (managed ruleset name=${RELEASE_RULESET_NAME})`,
      "direct OIDC registry publish is not enabled (stage-only Trusted Publisher)",
    ],
  };
  assertNoSecrets(JSON.stringify(report), "control-plane report");
  return report;
}

async function applyMutations(
  plan: SetupPlan,
  actual: ActualControlPlane,
  deps: SetupDeps,
  writes: string[],
): Promise<void> {
  if (applyBlocked(plan)) {
    deps.log("release:setup APPLY STOPPED — plan contains STOP/CRITICAL; zero writes");
    return;
  }
  const pending = mutatingItems(plan).filter((i) => i.action !== "SET_READY");
  for (const item of pending) {
    deps.log(`applying ${item.action} ${item.resource}`);
    if (item.id === "environment" && item.action === "CREATE") {
      await deps.github.createEnvironment();
      writes.push(item.id);
    } else if (item.id === "environment" && item.action === "UPDATE") {
      await deps.github.updateEnvironment();
      writes.push(item.id);
    } else if (item.id === "ruleset" && item.action === "CREATE") {
      await deps.github.createRuleset();
      writes.push(item.id);
    } else if (item.id === "ruleset" && item.action === "UPDATE") {
      const id = actual.ruleset.managed[0]?.id;
      if (id === undefined) throw new Error("cannot UPDATE ruleset without id");
      await deps.github.updateRuleset(id);
      writes.push(item.id);
    } else if (item.id.startsWith("tp:") && item.action === "CREATE") {
      await deps.npm.addTrustedPublisher(item.resource);
      writes.push(item.id);
      const remainingTp = pending.filter(
        (p) => p.id.startsWith("tp:") && p.action === "CREATE" && !writes.includes(p.id),
      );
      if (remainingTp.length > 0) {
        await (deps.paceTrustedPublisherWrites ?? defaultPaceTrustedPublisherWrites)(
          TRUSTED_PUBLISHER_WRITE_PACE_MS,
        );
      }
    } else if (item.id.startsWith("security:") && item.action === "UPDATE") {
      await deps.npm.applyAutomatableSecurity(item.resource);
      writes.push(item.id);
    } else {
      throw new Error(`internal: refusing unapproved mutation ${item.action} ${item.id}`);
    }
  }
}

async function maybeSetReady(deps: SetupDeps, writes: string[]): Promise<void> {
  deps.log("read-back after mutations (READY still unset)…");
  const after = await discoverActual(deps);
  const flags = evaluatePrerequisites(after);
  if (!prerequisitesPass(flags)) {
    deps.log("read-back: prerequisites incomplete — READY not set");
    return;
  }
  if (after.readyVariable.value === "true") {
    deps.log("read-back: READY already true");
    return;
  }
  deps.log(`setting ${READY_VARIABLE_NAME}=true (last write)`);
  await deps.github.setReadyVariable();
  writes.push("ready");
}

export async function runReleaseSetup(mode: SetupMode, deps: SetupDeps): Promise<SetupResult> {
  for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (process.env[tokenVar]) {
      throw new Error(`${tokenVar} must not be present — release:setup is credential-env-free`);
    }
  }
  const github = mode === "check" ? readOnlyGitHub(deps.github) : deps.github;
  const npm = mode === "check" ? readOnlyNpm(deps.npm) : deps.npm;
  const guarded: SetupDeps = { ...deps, github, npm };

  deps.log(`release:setup ${mode} — discovering ${RELEASE_REPO_SLUG} (read first)…`);
  const actual = await discoverActual(guarded);
  const plan = planReleaseControlPlane(actual, mode);
  printPlan(plan, deps.log);

  const writes: string[] = [];
  if (mode === "apply") {
    if (mutatingItems(plan).length === 0) {
      deps.log("second/idempotent apply: NO CHANGES REQUIRED");
    } else {
      await applyMutations(plan, actual, guarded, writes);
      if (!applyBlocked(plan)) {
        await maybeSetReady(guarded, writes);
      }
    }
  }

  const finalActual = mode === "apply" && writes.length > 0 ? await discoverActual(guarded) : actual;
  const finalPlan = mode === "apply" && writes.length > 0 ? planReleaseControlPlane(finalActual, mode) : plan;
  if (mode === "apply" && writes.length > 0) {
    deps.log("final read-back:");
    printPlan(finalPlan, deps.log);
    const flags = evaluatePrerequisites(finalActual);
    if (finalActual.readyVariable.value === "true" && !prerequisitesPass(flags)) {
      throw new Error(
        "CRITICAL: READY=true after apply but prerequisites failed read-back — fail loudly",
      );
    }
  }

  const report = buildReport(mode, finalPlan, finalActual, writes);
  const serialized = redactSecrets(JSON.stringify(report, null, 2) + "\n");
  assertNoSecrets(serialized, "written report");
  deps.writeReport?.(report);
  deps.log(`report: ${mode} verdict=${finalPlan.verdict} writes=${writes.length}`);
  return { mode, plan: finalPlan, report, writes, actual: finalActual };
}

export function parseSetupArgs(argv: string[]): SetupMode {
  const apply = argv.includes("--apply");
  const check = argv.includes("--check") || !apply;
  if (apply && argv.includes("--check")) {
    throw new Error("use exactly one of --check or --apply");
  }
  if (apply) return "apply";
  if (check) return "check";
  return "check";
}

async function defaultPaceTrustedPublisherWrites(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function liveDeps(): SetupDeps {
  return {
    github: new GhControlPlaneClient(),
    npm: new OfficialNpmTrustClient(),
    readWorkflow: defaultReadWorkflow,
    writeReport: (report) => {
      writeFileSync(DEFAULT_REPORT, JSON.stringify(report, null, 2) + "\n", "utf8");
    },
    log: (line) => {
      assertNoSecrets(line, "log line");
      console.log(redactSecrets(line));
    },
  };
}

function main(): void {
  const argv = process.argv.slice(2);
  if (argv.some((a) => /^(publish|unpublish|deprecate)$/i.test(a))) {
    fail("refusing argv that names a registry publish operation", 2);
  }
  let mode: SetupMode;
  try {
    mode = parseSetupArgs(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }
  if (!existsSync(join(root, ".github/workflows/release.yml"))) {
    fail("release.yml missing — Phase 2.4B contract is required", 2);
  }
  runReleaseSetup(mode, liveDeps())
    .then((result) => {
      if (result.plan.verdict === "BLOCKED") process.exit(2);
      if (result.plan.verdict === "NOT_READY") process.exit(1);
      process.exit(0);
    })
    .catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      fail(redactSecrets(message), 2);
    });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main();
}
