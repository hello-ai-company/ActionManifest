/**
 * release:setup — Release Control Plane controller.
 *
 *   pnpm release:setup --check-agent   Agent/CI-safe. GitHub + cached READY. No npm live.
 *   pnpm release:setup --audit-live    Full live read-back (npm trust list / security / auth).
 *   pnpm release:setup --check         Backward-compatible full live check (same as --audit-live).
 *   pnpm release:setup --apply         Explicit only. Print plan, then converge. READY last.
 *
 * DEFAULT DENY. READY last. No registry publish / staged publish / approve.
 * No release tag / GitHub Release / version bump. Human 2FA PoP is never automated.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";
import {
  DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE,
  loadManualSecurityAttestation,
  resolveAttestationPath,
  toAttestationApplication,
} from "./release-setup-attestation.js";
import {
  CONTROL_PLANE_FINGERPRINT_RELATIVE,
  buildFingerprintDocument,
  classifyFingerprintDrift,
  controlPlaneConfigSha256,
  currentFingerprintSections,
  defaultAttestationPolicy,
  documentIntegrityOk,
  liveAuditReason,
  parseFingerprintDocument,
  sectionsFromDocument,
  sha256Hex,
  type ControlPlaneFingerprintDocument,
} from "./release-setup-fingerprint.js";
import { GhControlPlaneClient, readOnlyGitHub, type GitHubControlPlaneClient } from "./release-setup-github.js";
import {
  OfficialNpmTrustClient,
  TRUSTED_PUBLISHER_WRITE_PACE_MS,
  agentSafeNpm,
  readOnlyNpm,
  type NpmTrustClient,
} from "./release-setup-npm.js";
import {
  APPROVED_CONFIG_SHA256_VARIABLE_NAME,
  READY_VARIABLE_NAME,
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  applyBlocked,
  approvedConfigShaMatches,
  assertNoSecrets,
  desiredControlPlane,
  evaluatePrerequisites,
  isAgentCheckMode,
  isApprovedConfigSha256,
  isReadOnlySetupMode,
  mutatingItems,
  planAgentControlPlaneCheck,
  planReleaseControlPlane,
  prerequisitesPass,
  queriesNpmLive,
  redactSecrets,
  type ActualControlPlane,
  type AgentCheckContext,
  type PackageSecurityActual,
  type PlanItem,
  type SecurityAttestationApplication,
  type SetupMode,
  type SetupPlan,
  type SetupVerdict,
  type TrustedPublisherActual,
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
  approved_config_sha256: {
    name: typeof APPROVED_CONFIG_SHA256_VARIABLE_NAME;
    value: string | null;
    computed: string | null;
    match: boolean | null;
  };
  mutations: { id: string; action: string; resource: string }[];
  items: PlanItem[];
  critical: string[];
  remaining_human: string[];
  registry_writes: string;
  notes: string[];
  npm_live_governance: "NOT_QUERIED" | "QUERIED";
  fingerprint: {
    sha256: string | null;
    expected: string | null;
    match: boolean | null;
    drift: string | null;
  };
}

export interface SetupResult {
  mode: SetupMode;
  plan: SetupPlan;
  report: ControlPlaneReport;
  writes: string[];
  actual: ActualControlPlane;
}

export interface SetupCli {
  mode: SetupMode;
  attestManualSecurity: boolean;
  attestationPath: string | null;
}

export interface SetupRunOptions {
  attestation?: SecurityAttestationApplication | null;
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

function notQueriedPublisher(packageName: string): TrustedPublisherActual {
  return {
    packageName,
    exists: false,
    status: "NOT_QUERIED",
    notes: ["NPM LIVE GOVERNANCE: NOT QUERIED"],
  };
}

function notQueriedSecurity(packageName: string): PackageSecurityActual {
  return {
    packageName,
    twoFactorRequired: "UNKNOWN",
    longLivedTokensDisallowed: "UNKNOWN",
    trustedPublishingUsed: "UNKNOWN",
    status: "NOT_QUERIED",
    notes: ["NPM LIVE GOVERNANCE: NOT QUERIED"],
  };
}

export async function discoverActual(
  deps: SetupDeps,
  mode: SetupMode = "check",
): Promise<ActualControlPlane> {
  const desired = desiredControlPlane();
  const repo = await deps.github.verifyRepo();
  const workflow = deps.readWorkflow();
  const environment = await deps.github.getEnvironment(RELEASE_ENVIRONMENT_NAME);
  const ruleset = await deps.github.listRulesets();
  const readyVariable = await deps.github.getVariable(READY_VARIABLE_NAME);
  const approvedConfigSha256 = await deps.github.getApprovedConfigSha256();
  if (isAgentCheckMode(mode)) {
    return {
      repo,
      workflowReferencesEnvironment: workflowReferencesNpmRelease(workflow),
      environment,
      ruleset,
      readyVariable,
      approvedConfigSha256,
      trustedPublishers: desired.packages.map(notQueriedPublisher),
      packageSecurity: desired.packages.map(notQueriedSecurity),
    };
  }
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
    approvedConfigSha256,
    trustedPublishers,
    packageSecurity,
  };
}

export function computeControlPlaneConfigSha256(
  workflowYaml: string,
  attestationSha256: string | null = attestationRecordSha256(),
): string {
  return controlPlaneConfigSha256(
    currentFingerprintSections(workflowYaml, defaultAttestationPolicy(attestationSha256)),
  );
}

export function loadCommittedFingerprint(repoRoot: string = root): ControlPlaneFingerprintDocument | null {
  const path = join(repoRoot, CONTROL_PLANE_FINGERPRINT_RELATIVE);
  if (!existsSync(path)) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    const doc = parseFingerprintDocument(parsed);
    if (!doc || !documentIntegrityOk(doc)) return null;
    return doc;
  } catch {
    return null;
  }
}

export function attestationRecordSha256(repoRoot: string = root): string | null {
  const path = join(repoRoot, DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE);
  if (!existsSync(path)) return null;
  return sha256Hex(readFileSync(path, "utf8"));
}

export function buildAgentCheckContext(
  workflowYaml: string,
  committed: ControlPlaneFingerprintDocument | null,
  attestationSha256: string | null = null,
): AgentCheckContext {
  const current = currentFingerprintSections(workflowYaml, defaultAttestationPolicy(attestationSha256));
  const computed = controlPlaneConfigSha256(current);
  if (!committed) {
    return {
      fingerprintSha256: computed,
      expectedSha256: null,
      fingerprintMatch: false,
      drift: "CONFIG_DRIFT",
      driftReason: "LIVE AUDIT REQUIRED — CONFIG DRIFT",
    };
  }
  const expected = sectionsFromDocument(committed);
  const drift = classifyFingerprintDrift(expected, current);
  return {
    fingerprintSha256: computed,
    expectedSha256: committed.sha256,
    fingerprintMatch: drift === null,
    drift,
    driftReason: liveAuditReason(drift),
  };
}

export function committedFingerprintDocumentFromWorkflow(workflowYaml: string): ControlPlaneFingerprintDocument {
  return buildFingerprintDocument(currentFingerprintSections(workflowYaml, defaultAttestationPolicy()));
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

function registryWritesNote(mode: SetupMode, writes: string[]): string {
  if (mode === "check-agent") {
    return "none (check-agent is read-only; npm live not queried)";
  }
  if (mode === "check" || mode === "audit-live") {
    return mode === "audit-live"
      ? "none (audit-live is read-only)"
      : "none (check is read-only)";
  }
  return writes.length === 0
    ? "none (idempotent — NO CHANGES REQUIRED)"
    : "approved control-plane settings only — no registry publish/stage/approve, no release tag, no GitHub Release";
}

function buildReport(
  mode: SetupMode,
  plan: SetupPlan,
  actual: ActualControlPlane,
  writes: string[],
  fingerprint: AgentCheckContext | null,
  computedSha256: string | null,
): ControlPlaneReport {
  const npmLive = queriesNpmLive(mode) ? "QUERIED" : "NOT_QUERIED";
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
    approved_config_sha256: {
      name: APPROVED_CONFIG_SHA256_VARIABLE_NAME,
      value: actual.approvedConfigSha256.value,
      computed: computedSha256,
      match: computedSha256
        ? approvedConfigShaMatches(actual.approvedConfigSha256, computedSha256)
        : null,
    },
    mutations: writes.map((id) => {
      const item = plan.items.find((i) => i.id === id);
      return { id, action: item?.action ?? "UNKNOWN", resource: item?.resource ?? id };
    }),
    items: plan.items,
    critical: plan.critical,
    remaining_human: plan.remainingHuman,
    registry_writes: registryWritesNote(mode, writes),
    npm_live_governance: npmLive,
    fingerprint: {
      sha256: fingerprint?.fingerprintSha256 ?? null,
      expected: fingerprint?.expectedSha256 ?? null,
      match: fingerprint ? fingerprint.fingerprintMatch : null,
      drift: fingerprint?.drift ?? null,
    },
    notes: [
      ...plan.notes,
      `unrelated environments/rulesets preserved (managed ruleset name=${RELEASE_RULESET_NAME})`,
      "direct OIDC registry publish is not enabled (stage-only Trusted Publisher)",
      "MANUAL_REQUIRED/UNSUPPORTED still block READY unless --attest-manual-security loads a valid non-secret attestation (never silent PASS, never stored credentials)",
      mode === "check-agent"
        ? "NPM LIVE GOVERNANCE: NOT QUERIED — attestation is not live npm security proof"
        : "live npm governance queried (trust list / package security / auth detection)",
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

async function persistApprovedConfigSha256(
  deps: SetupDeps,
  writes: string[],
  actual: ActualControlPlane,
  computed: string,
): Promise<void> {
  if (!isApprovedConfigSha256(computed)) {
    throw new Error("internal: computed CONTROL_PLANE_CONFIG_SHA256 is not a SHA-256 hex");
  }
  if (approvedConfigShaMatches(actual.approvedConfigSha256, computed)) {
    return;
  }
  deps.log(`setting ${APPROVED_CONFIG_SHA256_VARIABLE_NAME}=${computed} (before READY)`);
  await deps.github.setApprovedConfigSha256(computed);
  writes.push("approved-config-sha");
}

async function maybePersistApprovedAndSetReady(
  deps: SetupDeps,
  writes: string[],
  attestation?: SecurityAttestationApplication | null,
): Promise<void> {
  deps.log("read-back before READY (approved hash then READY last)…");
  const after = await discoverActual(deps, "apply");
  const flags = evaluatePrerequisites(after, desiredControlPlane(), attestation);
  if (!prerequisitesPass(flags)) {
    deps.log("read-back: prerequisites incomplete — approved hash and READY not set");
    return;
  }
  const computed = computeControlPlaneConfigSha256(deps.readWorkflow());
  await persistApprovedConfigSha256(deps, writes, after, computed);
  if (after.readyVariable.value === "true") {
    deps.log("read-back: READY already true");
    return;
  }
  deps.log(`setting ${READY_VARIABLE_NAME}=true (last write)`);
  await deps.github.setReadyVariable();
  writes.push("ready");
}

export async function runReleaseSetup(
  mode: SetupMode,
  deps: SetupDeps,
  options?: SetupRunOptions,
): Promise<SetupResult> {
  for (const tokenVar of ["NPM_TOKEN", "NODE_AUTH_TOKEN"]) {
    if (process.env[tokenVar]) {
      throw new Error(`${tokenVar} must not be present — release:setup is credential-env-free`);
    }
  }
  const attestation = options?.attestation ?? null;
  const github = isReadOnlySetupMode(mode) ? readOnlyGitHub(deps.github) : deps.github;
  const npm = isAgentCheckMode(mode) ? agentSafeNpm() : mode === "apply" ? deps.npm : readOnlyNpm(deps.npm);
  const guarded: SetupDeps = { ...deps, github, npm };

  deps.log(`release:setup ${mode} — discovering ${RELEASE_REPO_SLUG} (read first)…`);
  if (isAgentCheckMode(mode)) {
    deps.log("NPM LIVE GOVERNANCE: NOT QUERIED");
  }
  const actual = await discoverActual(guarded, mode);
  const workflowYaml = deps.readWorkflow();
  const computedSha256 = computeControlPlaneConfigSha256(workflowYaml);
  const agentCtx = isAgentCheckMode(mode)
    ? buildAgentCheckContext(workflowYaml, loadCommittedFingerprint(), attestationRecordSha256())
    : null;
  const plan = isAgentCheckMode(mode)
    ? planAgentControlPlaneCheck(actual, agentCtx!, desiredControlPlane(), attestation)
    : planReleaseControlPlane(actual, mode, desiredControlPlane(), attestation);
  printPlan(plan, deps.log);

  const writes: string[] = [];
  if (mode === "apply") {
    if (mutatingItems(plan).length === 0) {
      deps.log("second/idempotent apply: NO CHANGES REQUIRED");
    } else {
      await applyMutations(plan, actual, guarded, writes);
    }
    if (!applyBlocked(plan)) {
      await maybePersistApprovedAndSetReady(guarded, writes, attestation);
    }
  } else if (mode === "audit-live") {
    const flags = evaluatePrerequisites(actual, desiredControlPlane(), attestation);
    if (prerequisitesPass(flags)) {
      const computed = computeControlPlaneConfigSha256(workflowYaml);
      await persistApprovedConfigSha256(deps, writes, actual, computed);
    }
  }

  const finalActual =
    mode === "apply" && writes.length > 0 ? await discoverActual(guarded, mode) : actual;
  const finalPlan =
    mode === "apply" && writes.length > 0
      ? planReleaseControlPlane(finalActual, mode, desiredControlPlane(), attestation)
      : plan;
  if (mode === "apply" && writes.length > 0) {
    deps.log("final read-back:");
    printPlan(finalPlan, deps.log);
    const flags = evaluatePrerequisites(finalActual, desiredControlPlane(), attestation);
    if (finalActual.readyVariable.value === "true" && !prerequisitesPass(flags)) {
      throw new Error(
        "CRITICAL: READY=true after apply but prerequisites failed read-back — fail loudly",
      );
    }
  }

  const report = buildReport(mode, finalPlan, finalActual, writes, agentCtx, computedSha256);
  const serialized = redactSecrets(JSON.stringify(report, null, 2) + "\n");
  assertNoSecrets(serialized, "written report");
  deps.writeReport?.(report);
  deps.log(`report: ${mode} verdict=${finalPlan.verdict} writes=${writes.length}`);
  if (isAgentCheckMode(mode)) {
    deps.log(`NPM LIVE GOVERNANCE: ${report.npm_live_governance}`);
    if (finalPlan.verdict === "PASS") {
      deps.log("Human action required: none");
    }
  }
  return { mode, plan: finalPlan, report, writes, actual: finalActual };
}

const SETUP_MODE_FLAGS: { flag: string; mode: SetupMode }[] = [
  { flag: "--apply", mode: "apply" },
  { flag: "--check-agent", mode: "check-agent" },
  { flag: "--audit-live", mode: "audit-live" },
  { flag: "--check", mode: "check" },
];

export function parseSetupArgs(argv: string[]): SetupMode {
  const selected = SETUP_MODE_FLAGS.filter((m) => argv.includes(m.flag));
  if (selected.length > 1) {
    throw new Error("use exactly one of --check, --check-agent, --audit-live, or --apply");
  }
  if (selected.length === 1) return selected[0]!.mode;
  return "check";
}

export function parseSetupCli(argv: string[]): SetupCli {
  const mode = parseSetupArgs(argv);
  let attestManualSecurity = false;
  let attestationPath: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--attest-manual-security") {
      attestManualSecurity = true;
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        attestationPath = next;
        i += 1;
      }
    } else if (arg.startsWith("--attest-manual-security=")) {
      attestManualSecurity = true;
      const value = arg.slice("--attest-manual-security=".length).trim();
      if (value) attestationPath = value;
    }
  }
  if (attestManualSecurity && !attestationPath) {
    attestationPath = DEFAULT_MANUAL_SECURITY_ATTESTATION_RELATIVE;
  }
  return { mode, attestManualSecurity, attestationPath };
}

async function defaultPaceTrustedPublisherWrites(ms: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
}

function liveDeps(mode: SetupMode): SetupDeps {
  return {
    github: new GhControlPlaneClient(),
    npm: isAgentCheckMode(mode) ? agentSafeNpm() : new OfficialNpmTrustClient(),
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
  let cli: SetupCli;
  try {
    cli = parseSetupCli(argv);
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error), 2);
  }
  if (!existsSync(join(root, ".github/workflows/release.yml"))) {
    fail("release.yml missing — Phase 2.4B contract is required", 2);
  }
  const loaded = loadManualSecurityAttestation({
    requested: cli.attestManualSecurity,
    path: cli.attestationPath ? resolveAttestationPath(root, cli.attestationPath) : null,
  });
  const attestation = toAttestationApplication(loaded);
  runReleaseSetup(cli.mode, liveDeps(cli.mode), { attestation })
    .then((result) => {
      if (result.plan.verdict === "BLOCKED") process.exit(2);
      if (result.plan.verdict === "NOT_READY" || result.plan.verdict === "LIVE_AUDIT_REQUIRED") {
        process.exit(1);
      }
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
