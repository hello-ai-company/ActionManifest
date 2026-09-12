/**
 * Pure release-control-plane planner.
 *
 * NO I/O, NO network, no process control — importing this module has zero
 * side effects. actual + desired → plan. The CLI lives in release-setup.ts.
 *
 * DEFAULT DENY → READ-ONLY DISCOVERY → EXPECTED STATE DIFF → EXPLICIT --apply
 * → WRITE ONLY APPROVED SETTINGS → READ-BACK → READY FLAG LAST.
 */
import { PUBLIC_PACKAGE_NAMES } from "./release-identity.js";

export const RELEASE_OWNER = "hello-ai-company";
export const RELEASE_REPO = "ActionManifest";
export const RELEASE_REPO_SLUG = `${RELEASE_OWNER}/${RELEASE_REPO}`;
export const RELEASE_ENVIRONMENT_NAME = "npm-release";
export const RELEASE_RULESET_NAME = "actionmanifest-release-tags";
export const RELEASE_TAG_INCLUDE = "refs/tags/v*";
export const RELEASE_TAG_PATTERN = "v*";
export const READY_VARIABLE_NAME = "NPM_TRUSTED_PUBLISHING_READY";
export const TRUSTED_PUBLISHER_WORKFLOW = "release.yml";
export const TRUSTED_PUBLISHER_PROVIDER = "github";
export const MANAGED_RULESET_RULES = ["deletion", "update", "non_fast_forward"] as const;

export type ResourceStatus =
  | "OK"
  | "MISSING"
  | "DRIFTED"
  | "MANUAL_REQUIRED"
  | "AUTH_REQUIRED"
  | "UNKNOWN"
  | "UNSUPPORTED";

export type PlanAction = "CREATE" | "UPDATE" | "NOOP" | "STOP" | "MANUAL" | "SET_READY";
export type SetupVerdict = "READY" | "NOT_READY" | "BLOCKED";
export type SetupMode = "check" | "apply";

export interface DesiredTrustedPublisher {
  provider: "github";
  org: typeof RELEASE_OWNER;
  repo: typeof RELEASE_REPO;
  workflow: typeof TRUSTED_PUBLISHER_WORKFLOW;
  environment: typeof RELEASE_ENVIRONMENT_NAME;
  allowStagePublish: true;
  allowPublish: false;
}

export interface DesiredRuleset {
  name: typeof RELEASE_RULESET_NAME;
  target: "tag";
  enforcement: "active";
  include: typeof RELEASE_TAG_INCLUDE;
  rules: readonly string[];
}

export interface DesiredEnvironment {
  name: typeof RELEASE_ENVIRONMENT_NAME;
  deploymentBranches: readonly ["main"];
  requiredReviewersOptional: true;
}

export interface DesiredControlPlane {
  repo: typeof RELEASE_REPO_SLUG;
  environment: DesiredEnvironment;
  ruleset: DesiredRuleset;
  readyVariable: typeof READY_VARIABLE_NAME;
  trustedPublisher: DesiredTrustedPublisher;
  packages: readonly string[];
}

export function desiredControlPlane(): DesiredControlPlane {
  return {
    repo: RELEASE_REPO_SLUG,
    environment: {
      name: RELEASE_ENVIRONMENT_NAME,
      deploymentBranches: ["main"],
      requiredReviewersOptional: true,
    },
    ruleset: {
      name: RELEASE_RULESET_NAME,
      target: "tag",
      enforcement: "active",
      include: RELEASE_TAG_INCLUDE,
      rules: MANAGED_RULESET_RULES,
    },
    readyVariable: READY_VARIABLE_NAME,
    trustedPublisher: {
      provider: TRUSTED_PUBLISHER_PROVIDER,
      org: RELEASE_OWNER,
      repo: RELEASE_REPO,
      workflow: TRUSTED_PUBLISHER_WORKFLOW,
      environment: RELEASE_ENVIRONMENT_NAME,
      allowStagePublish: true,
      allowPublish: false,
    },
    packages: PUBLIC_PACKAGE_NAMES,
  };
}

export interface GitHubEnvironmentActual {
  exists: boolean;
  name?: string;
  deploymentBranches: string[];
  requiredReviewerCount: number;
  secretNames: string[];
  status: ResourceStatus;
  notes: string[];
}

export interface RulesetSnapshot {
  id: number;
  name: string;
  target: string;
  enforcement: string;
  include: string[];
  rules: string[];
}

export interface TagRulesetActual {
  managed: RulesetSnapshot[];
  unrelated: { id: number; name: string }[];
  status: ResourceStatus;
  notes: string[];
}

export interface ReadyVariableActual {
  exists: boolean;
  value: string | null;
  status: ResourceStatus;
  notes: string[];
}

export interface TrustedPublisherRecord {
  id?: string;
  provider: string;
  org: string;
  repo: string;
  workflow: string;
  environment: string;
  allowStagePublish: boolean;
  allowPublish: boolean;
}

export interface TrustedPublisherActual {
  packageName: string;
  exists: boolean;
  publisher?: TrustedPublisherRecord;
  status: ResourceStatus;
  notes: string[];
}

export interface PackageSecurityActual {
  packageName: string;
  twoFactorRequired: boolean | "UNKNOWN";
  longLivedTokensDisallowed: boolean | "UNKNOWN";
  trustedPublishingUsed: boolean | "UNKNOWN";
  status: ResourceStatus;
  notes: string[];
}

export interface RepoIdentityActual {
  slug: string;
  verified: boolean;
  status: ResourceStatus;
  notes: string[];
}

export interface ActualControlPlane {
  repo: RepoIdentityActual;
  workflowReferencesEnvironment: boolean;
  environment: GitHubEnvironmentActual;
  ruleset: TagRulesetActual;
  readyVariable: ReadyVariableActual;
  trustedPublishers: TrustedPublisherActual[];
  packageSecurity: PackageSecurityActual[];
}

export interface PlanItem {
  id: string;
  resource: string;
  action: PlanAction;
  status: ResourceStatus;
  reason: string;
  mutates: boolean;
  order: number;
  diff?: string[];
}

export interface SetupPlan {
  mode: SetupMode;
  verdict: SetupVerdict;
  items: PlanItem[];
  critical: string[];
  readyLast: true;
  remainingHuman: string[];
  notes: string[];
}

export const HUMAN_BOUNDARY_NOTES = [
  "npm auth / account 2FA / WebAuthn / security-key when the official CLI requests it — never automated",
  "staged-package approval remains a human 2FA proof-of-presence step — never automated",
  "GitHub Environment required reviewers are OPTIONAL (npm staged approval + 2FA is the mandatory human gate)",
] as const;

const FORBIDDEN_OUTPUT = [
  /authorization\s*[:=]/i,
  /bearer\s+[a-z0-9._-]+/i,
  /NPM_TOKEN/i,
  /NODE_AUTH_TOKEN/i,
  /\bOTP\b/i,
  /cookie\s*[:=]/i,
];

/** True when serialized output would leak a credential-shaped token. */
export function containsForbiddenSecret(text: string): boolean {
  return FORBIDDEN_OUTPUT.some((re) => re.test(text));
}

/** Replace credential-shaped spans. Never used to hide planner decisions. */
export function redactSecrets(text: string): string {
  return text
    .replace(/authorization\s*[:=]\s*.+$/gim, "authorization=[REDACTED]")
    .replace(/bearer\s+\S+/gi, "bearer [REDACTED]")
    .replace(/NPM_TOKEN\s*[:=]\s*\S+/gi, "NPM_TOKEN=[REDACTED]")
    .replace(/NODE_AUTH_TOKEN\s*[:=]\s*\S+/gi, "NODE_AUTH_TOKEN=[REDACTED]")
    .replace(/cookie\s*[:=]\s*\S+/gi, "cookie=[REDACTED]");
}

export function assertNoSecrets(text: string, label = "output"): void {
  if (containsForbiddenSecret(text)) {
    throw new Error(`${label} contains a forbidden credential-shaped token`);
  }
}

export function environmentMatches(
  actual: GitHubEnvironmentActual,
  desired: DesiredEnvironment,
): boolean {
  if (!actual.exists || actual.status !== "OK") return false;
  if (actual.name !== desired.name) return false;
  return desired.deploymentBranches.every((b) => actual.deploymentBranches.includes(b));
}

export function rulesetMatches(snapshot: RulesetSnapshot, desired: DesiredRuleset): boolean {
  if (snapshot.name !== desired.name) return false;
  if (snapshot.target !== desired.target) return false;
  if (snapshot.enforcement !== desired.enforcement) return false;
  const includeOk = snapshot.include.some(
    (p) => p === desired.include || p === RELEASE_TAG_PATTERN || p === `refs/tags/${RELEASE_TAG_PATTERN}`,
  );
  if (!includeOk) return false;
  return desired.rules.every((r) => snapshot.rules.includes(r));
}

export function rulesetDiff(snapshot: RulesetSnapshot, desired: DesiredRuleset): string[] {
  const diff: string[] = [];
  if (snapshot.target !== desired.target) {
    diff.push(`target: ${snapshot.target} → ${desired.target}`);
  }
  if (snapshot.enforcement !== desired.enforcement) {
    diff.push(`enforcement: ${snapshot.enforcement} → ${desired.enforcement}`);
  }
  const includeOk = snapshot.include.some(
    (p) => p === desired.include || p === RELEASE_TAG_PATTERN,
  );
  if (!includeOk) {
    diff.push(`include: [${snapshot.include.join(", ")}] → ${desired.include}`);
  }
  const missingRules = desired.rules.filter((r) => !snapshot.rules.includes(r));
  if (missingRules.length > 0) {
    diff.push(`rules missing: ${missingRules.join(", ")}`);
  }
  return diff;
}

export function publisherMatches(
  record: TrustedPublisherRecord,
  desired: DesiredTrustedPublisher,
): boolean {
  return (
    normalizeProvider(record.provider) === desired.provider &&
    record.org === desired.org &&
    record.repo === desired.repo &&
    record.workflow === desired.workflow &&
    record.environment === desired.environment &&
    record.allowStagePublish === true &&
    record.allowPublish === false
  );
}

export function publisherIdentityDrift(
  record: TrustedPublisherRecord,
  desired: DesiredTrustedPublisher,
): boolean {
  return (
    normalizeProvider(record.provider) !== desired.provider ||
    record.org !== desired.org ||
    record.repo !== desired.repo ||
    record.workflow !== desired.workflow ||
    record.environment !== desired.environment
  );
}

export function normalizeProvider(provider: string): string {
  const p = provider.trim().toLowerCase();
  if (p === "github actions" || p === "github-actions" || p === "github_actions") return "github";
  return p;
}

export function readyValueIsTrue(value: string | null | undefined): boolean {
  return value === "true";
}

export interface PrerequisiteFlags {
  repoOk: boolean;
  workflowOk: boolean;
  environmentOk: boolean;
  rulesetOk: boolean;
  trustedPublishersOk: boolean;
  securityBlocksReady: boolean;
}

export function evaluatePrerequisites(
  actual: ActualControlPlane,
  desired: DesiredControlPlane = desiredControlPlane(),
): PrerequisiteFlags {
  const byName = new Map(actual.trustedPublishers.map((t) => [t.packageName, t]));
  const trustedPublishersOk = desired.packages.every((name) => {
    const row = byName.get(name);
    return Boolean(
      row &&
        row.status === "OK" &&
        row.exists &&
        row.publisher &&
        publisherMatches(row.publisher, desired.trustedPublisher),
    );
  });
  const securityBlocksReady = desired.packages.some((name) => {
    const row = actual.packageSecurity.find((s) => s.packageName === name);
    if (!row) return true;
    return (
      row.status === "AUTH_REQUIRED" ||
      row.status === "UNKNOWN" ||
      row.status === "DRIFTED" ||
      row.status === "MISSING"
    );
  });
  const rulesetOk =
    actual.ruleset.managed.length === 1 &&
    actual.ruleset.status === "OK" &&
    rulesetMatches(actual.ruleset.managed[0]!, desired.ruleset);
  return {
    repoOk: actual.repo.verified && actual.repo.status === "OK",
    workflowOk: actual.workflowReferencesEnvironment,
    environmentOk: environmentMatches(actual.environment, desired.environment),
    rulesetOk,
    trustedPublishersOk,
    securityBlocksReady,
  };
}

export function prerequisitesPass(flags: PrerequisiteFlags): boolean {
  return (
    flags.repoOk &&
    flags.workflowOk &&
    flags.environmentOk &&
    flags.rulesetOk &&
    flags.trustedPublishersOk &&
    !flags.securityBlocksReady
  );
}

function item(partial: PlanItem): PlanItem {
  return partial;
}

/**
 * actual + desired → plan. Pure. READY is the last mutating item when planned.
 */
export function planReleaseControlPlane(
  actual: ActualControlPlane,
  mode: SetupMode = "check",
  desired: DesiredControlPlane = desiredControlPlane(),
): SetupPlan {
  const items: PlanItem[] = [];
  const critical: string[] = [];
  const notes: string[] = [...HUMAN_BOUNDARY_NOTES];
  let blocked = false;

  if (!actual.repo.verified || actual.repo.status === "AUTH_REQUIRED") {
    blocked = true;
    items.push(
      item({
        id: "repo",
        resource: RELEASE_REPO_SLUG,
        action: "STOP",
        status: actual.repo.status,
        reason:
          actual.repo.notes[0] ??
          `GitHub identity must be ${RELEASE_REPO_SLUG} (fail closed)`,
        mutates: false,
        order: 0,
      }),
    );
  } else if (actual.repo.slug !== desired.repo) {
    blocked = true;
    items.push(
      item({
        id: "repo",
        resource: actual.repo.slug,
        action: "STOP",
        status: "DRIFTED",
        reason: `refusing to operate on ${actual.repo.slug}; expected ${desired.repo}`,
        mutates: false,
        order: 0,
      }),
    );
  } else {
    items.push(
      item({
        id: "repo",
        resource: desired.repo,
        action: "NOOP",
        status: "OK",
        reason: "gh auth + repository identity verified",
        mutates: false,
        order: 0,
      }),
    );
  }

  if (!actual.workflowReferencesEnvironment) {
    blocked = true;
    critical.push(
      "CRITICAL: .github/workflows/release.yml must reference environment: npm-release",
    );
    items.push(
      item({
        id: "workflow-environment",
        resource: "release.yml",
        action: "STOP",
        status: "DRIFTED",
        reason: "release.yml does not reference environment: npm-release (Phase 2.4B contract)",
        mutates: false,
        order: 1,
      }),
    );
  } else {
    items.push(
      item({
        id: "workflow-environment",
        resource: "release.yml",
        action: "NOOP",
        status: "OK",
        reason: "release.yml stage job references environment: npm-release",
        mutates: false,
        order: 1,
      }),
    );
  }

  // 1. Environment
  if (actual.environment.status === "AUTH_REQUIRED" || actual.environment.status === "UNKNOWN") {
    blocked = true;
    items.push(
      item({
        id: "environment",
        resource: RELEASE_ENVIRONMENT_NAME,
        action: "STOP",
        status: actual.environment.status,
        reason: actual.environment.notes[0] ?? "cannot read GitHub Environment npm-release",
        mutates: false,
        order: 10,
      }),
    );
  } else if (!actual.environment.exists || actual.environment.status === "MISSING") {
    items.push(
      item({
        id: "environment",
        resource: RELEASE_ENVIRONMENT_NAME,
        action: "CREATE",
        status: "MISSING",
        reason: "GitHub Environment npm-release is missing",
        mutates: true,
        order: 10,
      }),
    );
  } else if (environmentMatches(actual.environment, desired.environment)) {
    const secretHits = actual.environment.secretNames.filter((n) =>
      /NPM_TOKEN|NODE_AUTH_TOKEN/i.test(n),
    );
    if (secretHits.length > 0) {
      blocked = true;
      critical.push(
        `CRITICAL: Environment npm-release lists forbidden secret name(s): ${secretHits.join(", ")}`,
      );
      items.push(
        item({
          id: "environment",
          resource: RELEASE_ENVIRONMENT_NAME,
          action: "STOP",
          status: "DRIFTED",
          reason: `forbidden environment secrets present: ${secretHits.join(", ")} (do not auto-delete)`,
          mutates: false,
          order: 10,
        }),
      );
    } else {
      items.push(
        item({
          id: "environment",
          resource: RELEASE_ENVIRONMENT_NAME,
          action: "NOOP",
          status: "OK",
          reason:
            actual.environment.requiredReviewerCount > 0
              ? `exists; main deployment branch; ${actual.environment.requiredReviewerCount} reviewer(s) preserved (optional)`
              : "exists; main deployment branch; required reviewers optional and absent",
          mutates: false,
          order: 10,
        }),
      );
    }
  } else {
    items.push(
      item({
        id: "environment",
        resource: RELEASE_ENVIRONMENT_NAME,
        action: "UPDATE",
        status: "DRIFTED",
        reason: "Environment exists but deployment-branch policy does not include main",
        mutates: true,
        order: 10,
        diff: [
          `deploymentBranches: [${actual.environment.deploymentBranches.join(", ")}] → main`,
        ],
      }),
    );
  }

  // 2. Tag ruleset (managed name only; never touch unrelated)
  if (actual.ruleset.status === "AUTH_REQUIRED" || actual.ruleset.status === "UNKNOWN") {
    blocked = true;
    items.push(
      item({
        id: "ruleset",
        resource: RELEASE_RULESET_NAME,
        action: "STOP",
        status: actual.ruleset.status,
        reason: actual.ruleset.notes[0] ?? "cannot read repository rulesets",
        mutates: false,
        order: 20,
      }),
    );
  } else if (actual.ruleset.managed.length > 1) {
    blocked = true;
    items.push(
      item({
        id: "ruleset",
        resource: RELEASE_RULESET_NAME,
        action: "STOP",
        status: "DRIFTED",
        reason: `multiple rulesets named ${RELEASE_RULESET_NAME} (ids ${actual.ruleset.managed
          .map((r) => r.id)
          .join(", ")}) — STOP, no overwrite`,
        mutates: false,
        order: 20,
      }),
    );
  } else if (actual.ruleset.managed.length === 0) {
    items.push(
      item({
        id: "ruleset",
        resource: RELEASE_RULESET_NAME,
        action: "CREATE",
        status: "MISSING",
        reason: `managed tag ruleset ${RELEASE_RULESET_NAME} is missing (unrelated rulesets preserved)`,
        mutates: true,
        order: 20,
      }),
    );
  } else {
    const snap = actual.ruleset.managed[0]!;
    if (snap.target !== "tag") {
      blocked = true;
      items.push(
        item({
          id: "ruleset",
          resource: RELEASE_RULESET_NAME,
          action: "STOP",
          status: "DRIFTED",
          reason: `managed name exists with target=${snap.target} (not tag) — STOP for security review`,
          mutates: false,
          order: 20,
          diff: rulesetDiff(snap, desired.ruleset),
        }),
      );
    } else if (rulesetMatches(snap, desired.ruleset)) {
      items.push(
        item({
          id: "ruleset",
          resource: RELEASE_RULESET_NAME,
          action: "NOOP",
          status: "OK",
          reason: `ruleset ${RELEASE_RULESET_NAME} matches (pattern ${RELEASE_TAG_PATTERN}; delete/update protected)`,
          mutates: false,
          order: 20,
        }),
      );
    } else {
      items.push(
        item({
          id: "ruleset",
          resource: RELEASE_RULESET_NAME,
          action: "UPDATE",
          status: "DRIFTED",
          reason: `managed ruleset ${RELEASE_RULESET_NAME} differs from expected config`,
          mutates: true,
          order: 20,
          diff: rulesetDiff(snap, desired.ruleset),
        }),
      );
    }
  }

  // 3. Trusted Publishers — one row per PUBLIC_PACKAGE_NAMES (SoT)
  const tpByName = new Map(actual.trustedPublishers.map((t) => [t.packageName, t]));
  desired.packages.forEach((name, index) => {
    const row = tpByName.get(name);
    const order = 30 + index;
    if (!row) {
      items.push(
        item({
          id: `tp:${name}`,
          resource: name,
          action: "CREATE",
          status: "MISSING",
          reason: "Trusted Publisher record missing from discovery",
          mutates: true,
          order,
        }),
      );
      return;
    }
    if (row.status === "AUTH_REQUIRED" || row.status === "UNKNOWN" || row.status === "UNSUPPORTED") {
      blocked = row.status === "AUTH_REQUIRED" || blocked;
      items.push(
        item({
          id: `tp:${name}`,
          resource: name,
          action: "STOP",
          status: row.status,
          reason: row.notes[0] ?? `cannot determine Trusted Publisher for ${name}`,
          mutates: false,
          order,
        }),
      );
      return;
    }
    if (!row.exists || row.status === "MISSING" || !row.publisher) {
      items.push(
        item({
          id: `tp:${name}`,
          resource: name,
          action: "CREATE",
          status: "MISSING",
          reason: "no Trusted Publisher attached",
          mutates: true,
          order,
        }),
      );
      return;
    }
    if (publisherMatches(row.publisher, desired.trustedPublisher)) {
      items.push(
        item({
          id: `tp:${name}`,
          resource: name,
          action: "NOOP",
          status: "OK",
          reason: "GitHub Actions + hello-ai-company/ActionManifest + release.yml + npm-release + stage-only",
          mutates: false,
          order,
        }),
      );
      return;
    }
    // Wrong identity or direct publish enabled → STOP (never overwrite)
    blocked = true;
    const drift = publisherIdentityDrift(row.publisher, desired.trustedPublisher);
    items.push(
      item({
        id: `tp:${name}`,
        resource: name,
        action: "STOP",
        status: "DRIFTED",
        reason: drift
          ? "DRIFTED / SECURITY REVIEW REQUIRED — existing Trusted Publisher points at a different repo/workflow/env (no overwrite)"
          : "DRIFTED / SECURITY REVIEW REQUIRED — Trusted Publisher allows direct registry publish (no overwrite)",
        mutates: false,
        order,
        diff: [
          `${row.publisher.org}/${row.publisher.repo} ${row.publisher.workflow} env=${row.publisher.environment} publish=${row.publisher.allowPublish} stage=${row.publisher.allowStagePublish}`,
        ],
      }),
    );
  });

  // 4. Automatable security (never fake PASS)
  desired.packages.forEach((name, index) => {
    const row = actual.packageSecurity.find((s) => s.packageName === name);
    const order = 50 + index;
    if (!row) {
      items.push(
        item({
          id: `security:${name}`,
          resource: name,
          action: "MANUAL",
          status: "UNKNOWN",
          reason: "package security was not discovered — never fake PASS",
          mutates: false,
          order,
        }),
      );
      return;
    }
    if (row.status === "OK") {
      items.push(
        item({
          id: `security:${name}`,
          resource: name,
          action: "NOOP",
          status: "OK",
          reason: "2FA required + long-lived publish tokens disallowed + Trusted Publishing used",
          mutates: false,
          order,
        }),
      );
      return;
    }
    if (row.status === "MISSING" || row.status === "DRIFTED") {
      const automatable = row.notes.some((n) => n.includes("AUTOMATABLE"));
      items.push(
        item({
          id: `security:${name}`,
          resource: name,
          action: automatable ? "UPDATE" : "MANUAL",
          status: row.status,
          reason: row.notes[0] ?? "package security differs from desired",
          mutates: automatable,
          order,
        }),
      );
      return;
    }
    items.push(
      item({
        id: `security:${name}`,
        resource: name,
        action: row.status === "MANUAL_REQUIRED" || row.status === "UNSUPPORTED" ? "MANUAL" : "STOP",
        status: row.status,
        reason: row.notes[0] ?? "package security not safely readable/mutable via official CLI",
        mutates: false,
        order,
      }),
    );
    if (row.status === "AUTH_REQUIRED") blocked = true;
  });

  const flags = evaluatePrerequisites(actual, desired);
  const prereqsNow = prerequisitesPass(flags);
  const plannedCreatesOrUpdates = items.filter(
    (i) => i.mutates && (i.action === "CREATE" || i.action === "UPDATE"),
  );
  const stopItems = items.filter((i) => i.action === "STOP");
  const securityStops = items.some((i) => i.id.startsWith("security:") && i.action === "STOP");
  const wouldPassAfterApply =
    !blocked &&
    stopItems.length === 0 &&
    !securityStops &&
    items
      .filter((i) => i.id.startsWith("tp:") || i.id === "environment" || i.id === "ruleset")
      .every((i) => i.action === "NOOP" || i.action === "CREATE" || i.action === "UPDATE") &&
    flags.workflowOk &&
    flags.repoOk;

  const readyTrue = readyValueIsTrue(actual.readyVariable.value);
  if (readyTrue && !prereqsNow) {
    blocked = true;
    const msg =
      "CRITICAL: NPM_TRUSTED_PUBLISHING_READY=true but prerequisites are incomplete — fail loudly; do not auto-flip false";
    critical.push(msg);
    items.push(
      item({
        id: "ready",
        resource: READY_VARIABLE_NAME,
        action: "STOP",
        status: "DRIFTED",
        reason: msg,
        mutates: false,
        order: 90,
      }),
    );
  } else if (readyTrue && prereqsNow) {
    items.push(
      item({
        id: "ready",
        resource: READY_VARIABLE_NAME,
        action: "NOOP",
        status: "OK",
        reason: "READY=true and all prerequisites pass read-back",
        mutates: false,
        order: 90,
      }),
    );
  } else if (!readyTrue && prereqsNow) {
    items.push(
      item({
        id: "ready",
        resource: READY_VARIABLE_NAME,
        action: "SET_READY",
        status: "MISSING",
        reason: "prerequisites PASS — READY is the last write",
        mutates: true,
        order: 90,
      }),
    );
  } else if (!readyTrue && wouldPassAfterApply && plannedCreatesOrUpdates.length > 0) {
    items.push(
      item({
        id: "ready",
        resource: READY_VARIABLE_NAME,
        action: "SET_READY",
        status: "MISSING",
        reason: "planned after CREATE/UPDATE + read-back — READY last, never first",
        mutates: true,
        order: 90,
      }),
    );
  } else {
    items.push(
      item({
        id: "ready",
        resource: READY_VARIABLE_NAME,
        action: "NOOP",
        status: actual.readyVariable.status === "OK" ? "MISSING" : actual.readyVariable.status,
        reason: "READY stays false until prerequisites PASS read-back",
        mutates: false,
        order: 90,
      }),
    );
  }

  items.sort((a, b) => a.order - b.order);
  const readyIdx = items.findIndex((i) => i.id === "ready");
  const lastMutatingIdx = items.reduce((acc, it, idx) => (it.mutates ? idx : acc), -1);
  if (readyIdx >= 0 && items[readyIdx]!.mutates && lastMutatingIdx !== readyIdx) {
    throw new Error("internal: READY must be the last mutating plan item");
  }

  let verdict: SetupVerdict;
  if (blocked || critical.length > 0 || stopItems.length > 0) {
    verdict = "BLOCKED";
  } else if (readyTrue && prereqsNow) {
    verdict = "READY";
  } else {
    verdict = "NOT_READY";
  }

  const remainingHuman = [
    ...HUMAN_BOUNDARY_NOTES,
    ...items
      .filter((i) => i.action === "MANUAL")
      .map((i) => `${i.resource}: ${i.reason}`),
  ];

  const plan: SetupPlan = {
    mode,
    verdict,
    items,
    critical,
    readyLast: true,
    remainingHuman,
    notes,
  };
  assertNoSecrets(JSON.stringify(plan), "setup plan");
  return plan;
}

export function mutatingItems(plan: SetupPlan): PlanItem[] {
  return plan.items.filter((i) => i.mutates);
}

export function applyBlocked(plan: SetupPlan): boolean {
  return plan.items.some((i) => i.action === "STOP") || plan.critical.length > 0;
}
