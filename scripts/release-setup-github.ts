/**
 * GitHub control-plane client (REST via `gh api` only — never scrape the UI).
 *
 * Writes are opt-in methods. Check mode must wrap this client so write
 * methods throw. Unrelated environments / rulesets are never deleted.
 */
import { spawnSync } from "node:child_process";
import {
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_OWNER,
  RELEASE_REPO,
  RELEASE_REPO_SLUG,
  RELEASE_RULESET_NAME,
  READY_VARIABLE_NAME,
  desiredRulesetPayload,
  emptyEnvironmentActual,
  managedRulesetUpdatePayload,
  type EnvironmentReviewer,
  type GitHubEnvironmentActual,
  type ReadyVariableActual,
  type RepoIdentityActual,
  type RulesetRuleObject,
  type RulesetSnapshot,
  type TagRulesetActual,
} from "./release-setup-plan.js";

export interface GhApiResult {
  ok: boolean;
  status: number | null;
  stdout: string;
  stderr: string;
  json: unknown;
}

export interface GitHubControlPlaneClient {
  verifyRepo(): Promise<RepoIdentityActual>;
  getEnvironment(name: string): Promise<GitHubEnvironmentActual>;
  listRulesets(): Promise<TagRulesetActual>;
  getVariable(name: string): Promise<ReadyVariableActual>;
  createEnvironment(): Promise<void>;
  updateEnvironment(): Promise<void>;
  createRuleset(): Promise<void>;
  updateRuleset(id: number): Promise<void>;
  setReadyVariable(): Promise<void>;
}

export interface GitHubExec {
  (args: string[], body?: unknown): GhApiResult;
}

const FORBIDDEN_WRITE_PATHS = [
  /releases$/i,
  /git\/tags/i,
  /git\/refs\/tags/i,
];

function parseHttpStatus(stderr: string, stdout: string): number | null {
  const blob = `${stderr}\n${stdout}`;
  const m = blob.match(/\bHTTP\s+(\d{3})\b/i) ?? blob.match(/\b(\d{3})\s+(Not Found|Forbidden|Unauthorized|Bad Request)/i);
  if (m?.[1]) return Number(m[1]);
  return null;
}

export function defaultGhExec(args: string[], body?: unknown): GhApiResult {
  if (args.some((a) => FORBIDDEN_WRITE_PATHS.some((re) => re.test(a)))) {
    return {
      ok: false,
      status: 400,
      stdout: "",
      stderr: "refusing GitHub path that creates tags or Releases",
      json: null,
    };
  }
  const spawnArgs = ["api", ...args];
  const r = spawnSync("gh", spawnArgs, {
    encoding: "utf8",
    input: body === undefined ? undefined : JSON.stringify(body),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  let json: unknown = null;
  if (stdout.trim()) {
    try {
      json = JSON.parse(stdout);
    } catch {
      json = null;
    }
  }
  return {
    ok: r.status === 0,
    status: r.status === 0 ? 200 : parseHttpStatus(stderr, stdout),
    stdout,
    stderr,
    json,
  };
}

export interface GhReadResult {
  ok: boolean;
  status: number | null;
  json: unknown;
  stdout?: string;
  stderr?: string;
}

export function classifyGhReadFailure(status: number | null): "AUTH_REQUIRED" | "UNKNOWN" {
  return status === 401 || status === 403 ? "AUTH_REQUIRED" : "UNKNOWN";
}

const KNOWN_PROTECTION_TYPES = new Set(["wait_timer", "required_reviewers", "branch_policy"]);

export function parseReviewers(raw: unknown): { ok: true; reviewers: EnvironmentReviewer[] } | { ok: false } {
  if (raw == null) return { ok: true, reviewers: [] };
  if (!Array.isArray(raw)) return { ok: false };
  const reviewers: EnvironmentReviewer[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") return { ok: false };
    const r = row as { type?: unknown; id?: unknown; reviewer?: { id?: unknown; type?: unknown } };
    const type = r.type === "User" || r.type === "Team" ? r.type : r.reviewer?.type;
    const idRaw = typeof r.id === "number" ? r.id : r.reviewer?.id;
    if ((type !== "User" && type !== "Team") || typeof idRaw !== "number") return { ok: false };
    reviewers.push({ type, id: idRaw });
  }
  return { ok: true, reviewers };
}

export function buildEnvironmentPutBody(actual: GitHubEnvironmentActual): Record<string, unknown> {
  return {
    wait_timer: actual.waitTimer ?? 0,
    prevent_self_review: actual.preventSelfReview ?? false,
    reviewers: actual.requiredReviewers.map((r) => ({ type: r.type, id: r.id })),
    deployment_branch_policy: {
      protected_branches: false,
      custom_branch_policies: true,
    },
  };
}

export type EnvironmentWritePlan =
  | { kind: "CREATE"; putBody: Record<string, unknown> }
  | { kind: "POST_BRANCH_ONLY"; reason: string }
  | { kind: "PUT_THEN_POST"; reason: string; putBody: Record<string, unknown> }
  | { kind: "NOOP"; reason: string }
  | { kind: "STOP"; reason: string };

export function planEnvironmentWrite(actual: GitHubEnvironmentActual): EnvironmentWritePlan {
  if (actual.status === "AUTH_REQUIRED" || actual.status === "UNKNOWN") {
    return { kind: "STOP", reason: actual.notes[0] ?? "environment discovery fail-closed" };
  }
  if (!actual.exists || actual.status === "MISSING") {
    return {
      kind: "CREATE",
      putBody: {
        wait_timer: 0,
        prevent_self_review: false,
        reviewers: [],
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    };
  }
  if (actual.secretsReadStatus !== "OK" || actual.branchPoliciesReadStatus !== "OK") {
    return { kind: "STOP", reason: "refusing UPDATE on unread secrets or branch policies" };
  }
  const hasMain = actual.deploymentBranches.includes("main");
  const customOn = actual.deploymentBranchPolicy?.custom_branch_policies === true;
  if (hasMain && customOn) {
    return { kind: "NOOP", reason: "environment already has main + custom branch policies" };
  }
  if (!hasMain && customOn) {
    return { kind: "POST_BRANCH_ONLY", reason: "add main deployment branch policy; no Environment PUT" };
  }
  if (!actual.protectionMetadataRepresentable) {
    return { kind: "STOP", reason: "cannot represent protection metadata safely — no overwrite" };
  }
  return {
    kind: "PUT_THEN_POST",
    reason: "enable custom_branch_policies while preserving wait_timer/reviewers/prevent_self_review",
    putBody: buildEnvironmentPutBody(actual),
  };
}

export function parseEnvironmentDiscovery(
  name: string,
  envRes: GhReadResult,
  secretsRes: GhReadResult | null,
  branchRes: GhReadResult | null,
): GitHubEnvironmentActual {
  if (!envRes.ok) {
    if (envRes.status === 404 || /Not Found|404/i.test(`${envRes.stderr ?? ""}${envRes.stdout ?? ""}`)) {
      return emptyEnvironmentActual({
        exists: false,
        name,
        status: "MISSING",
        notes: [`environment ${name} does not exist`],
      });
    }
    const status = classifyGhReadFailure(envRes.status);
    return emptyEnvironmentActual({
      exists: false,
      name,
      status,
      notes: [
        status === "AUTH_REQUIRED"
          ? "cannot read GitHub Environment (401/403)"
          : "cannot read GitHub Environment",
      ],
    });
  }

  const body = (envRes.json ?? {}) as {
    name?: string;
    protection_rules?: {
      type?: string;
      wait_timer?: number;
      prevent_self_review?: boolean;
      reviewers?: unknown[];
    }[];
    wait_timer?: number;
    prevent_self_review?: boolean;
    deployment_branch_policy?: { custom_branch_policies?: boolean; protected_branches?: boolean } | null;
  };

  const rules = Array.isArray(body.protection_rules) ? body.protection_rules : [];
  let representable = true;
  for (const rule of rules) {
    if (rule?.type && !KNOWN_PROTECTION_TYPES.has(rule.type)) {
      representable = false;
    }
  }
  const waitRule = rules.find((r) => r.type === "wait_timer");
  const reviewerRule = rules.find((r) => r.type === "required_reviewers");
  const parsedReviewers = parseReviewers(reviewerRule?.reviewers);
  if (reviewerRule && !parsedReviewers.ok) representable = false;
  const reviewers = parsedReviewers.ok ? parsedReviewers.reviewers : [];
  const waitTimer =
    typeof waitRule?.wait_timer === "number"
      ? waitRule.wait_timer
      : typeof body.wait_timer === "number"
        ? body.wait_timer
        : waitRule
          ? null
          : 0;
  if (waitRule && waitTimer === null) representable = false;
  const preventSelfReview =
    typeof reviewerRule?.prevent_self_review === "boolean"
      ? reviewerRule.prevent_self_review
      : typeof body.prevent_self_review === "boolean"
        ? body.prevent_self_review
        : reviewerRule
          ? null
          : false;
  if (reviewerRule && preventSelfReview === null) representable = false;

  const policy = body.deployment_branch_policy;
  const deploymentBranchPolicy =
    policy && typeof policy.custom_branch_policies === "boolean" && typeof policy.protected_branches === "boolean"
      ? {
          custom_branch_policies: policy.custom_branch_policies,
          protected_branches: policy.protected_branches,
        }
      : policy == null
        ? null
        : null;
  if (policy && deploymentBranchPolicy === null) representable = false;

  if (!secretsRes || !secretsRes.ok) {
    const status = classifyGhReadFailure(secretsRes?.status ?? null);
    return emptyEnvironmentActual({
      exists: true,
      name: body.name ?? name,
      waitTimer,
      preventSelfReview,
      requiredReviewers: reviewers,
      requiredReviewerCount: reviewers.length,
      deploymentBranchPolicy,
      protectionMetadataRepresentable: representable,
      secretNames: [],
      secretsReadStatus: status,
      branchPoliciesReadStatus: "SKIPPED",
      status,
      notes: [
        status === "AUTH_REQUIRED"
          ? "cannot read environment secrets (401/403) — fail closed"
          : "cannot read environment secrets — fail closed",
      ],
    });
  }

  const secretNames: string[] = [];
  if (secretsRes.json && typeof secretsRes.json === "object") {
    const payload = secretsRes.json as { secrets?: { name?: string }[] };
    for (const s of payload.secrets ?? []) {
      if (s.name) secretNames.push(s.name);
    }
  }

  if (!branchRes || !branchRes.ok) {
    const status = classifyGhReadFailure(branchRes?.status ?? null);
    return emptyEnvironmentActual({
      exists: true,
      name: body.name ?? name,
      waitTimer,
      preventSelfReview,
      requiredReviewers: reviewers,
      requiredReviewerCount: reviewers.length,
      deploymentBranchPolicy,
      protectionMetadataRepresentable: representable,
      secretNames,
      secretsReadStatus: "OK",
      branchPoliciesReadStatus: status,
      status,
      notes: [
        status === "AUTH_REQUIRED"
          ? "cannot read deployment branch policies (401/403) — fail closed"
          : "cannot read deployment branch policies — fail closed",
      ],
    });
  }

  const branchNames: string[] = [];
  if (branchRes.json && typeof branchRes.json === "object") {
    const payload = branchRes.json as { branch_policies?: { name?: string }[] };
    for (const p of payload.branch_policies ?? []) {
      if (p.name) branchNames.push(p.name);
    }
  }

  return emptyEnvironmentActual({
    exists: true,
    name: body.name ?? name,
    deploymentBranches: branchNames,
    requiredReviewers: reviewers,
    requiredReviewerCount: reviewers.length,
    waitTimer,
    preventSelfReview,
    deploymentBranchPolicy,
    protectionMetadataRepresentable: representable,
    secretNames,
    secretsReadStatus: "OK",
    branchPoliciesReadStatus: "OK",
    status: "OK",
    notes: representable ? [] : ["environment has protection metadata that cannot be represented safely"],
  });
}

export class GhControlPlaneClient implements GitHubControlPlaneClient {
  constructor(private readonly exec: GitHubExec = defaultGhExec) {}

  async verifyRepo(): Promise<RepoIdentityActual> {
    const view = spawnSync(
      "gh",
      ["repo", "view", "--json", "nameWithOwner", "-q", ".nameWithOwner"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env },
    );
    if (view.status !== 0) {
      return {
        slug: "",
        verified: false,
        status: "AUTH_REQUIRED",
        notes: ["gh auth / repo view failed — fail closed"],
      };
    }
    const slug = view.stdout.trim();
    if (slug !== RELEASE_REPO_SLUG) {
      return {
        slug,
        verified: false,
        status: "DRIFTED",
        notes: [`gh repo is ${slug}, expected ${RELEASE_REPO_SLUG}`],
      };
    }
    return {
      slug,
      verified: true,
      status: "OK",
      notes: ["gh auth + repository identity verified"],
    };
  }

  async getEnvironment(name: string = RELEASE_ENVIRONMENT_NAME): Promise<GitHubEnvironmentActual> {
    const envRes = this.exec([
      "-X",
      "GET",
      `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${name}`,
    ]);
    let secretsRes: GhApiResult | null = null;
    let branchRes: GhApiResult | null = null;
    if (envRes.ok) {
      secretsRes = this.exec([
        "-X",
        "GET",
        `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${name}/secrets`,
      ]);
      branchRes = this.exec([
        "-X",
        "GET",
        `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${name}/deployment-branch-policies`,
      ]);
    }
    return parseEnvironmentDiscovery(name, envRes, secretsRes, branchRes);
  }

  async listRulesets(): Promise<TagRulesetActual> {
    const list = this.exec(["-X", "GET", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets`]);
    if (!list.ok) {
      const status: TagRulesetActual["status"] =
        list.status === 401 || list.status === 403 ? "AUTH_REQUIRED" : "UNKNOWN";
      return { managed: [], unrelated: [], status, notes: ["cannot list repository rulesets"] };
    }
    const rows = Array.isArray(list.json) ? list.json : [];
    const managed: RulesetSnapshot[] = [];
    const unrelated: { id: number; name: string }[] = [];
    for (const raw of rows) {
      if (!raw || typeof raw !== "object") continue;
      const row = raw as { id?: number; name?: string };
      if (typeof row.id !== "number" || typeof row.name !== "string") continue;
      if (row.name !== RELEASE_RULESET_NAME) {
        unrelated.push({ id: row.id, name: row.name });
        continue;
      }
      const detail = this.exec(["-X", "GET", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets/${row.id}`]);
      if (!detail.ok) {
        const status = classifyGhReadFailure(detail.status);
        return {
          managed: [],
          unrelated,
          status,
          notes: [
            status === "AUTH_REQUIRED"
              ? `cannot read ruleset ${row.id} detail (401/403)`
              : `cannot read ruleset ${row.id} detail (HTTP ${detail.status ?? "?"})`,
          ],
        };
      }
      managed.push(parseRulesetDetail(row.id, row.name, detail.json));
    }
    return {
      managed,
      unrelated,
      status: managed.length === 0 ? "MISSING" : "OK",
      notes: [],
    };
  }

  async getVariable(name: string = READY_VARIABLE_NAME): Promise<ReadyVariableActual> {
    const res = this.exec([
      "-X",
      "GET",
      `repos/${RELEASE_OWNER}/${RELEASE_REPO}/actions/variables/${name}`,
    ]);
    if (!res.ok) {
      if (res.status === 404 || /Not Found|404/i.test(res.stderr + res.stdout)) {
        return { exists: false, value: null, status: "MISSING", notes: [`variable ${name} is unset`] };
      }
      if (res.status === 401 || res.status === 403) {
        return {
          exists: false,
          value: null,
          status: "AUTH_REQUIRED",
          notes: ["cannot read repository variable"],
        };
      }
      return { exists: false, value: null, status: "UNKNOWN", notes: ["cannot read repository variable"] };
    }
    const value =
      res.json && typeof res.json === "object" && "value" in res.json
        ? String((res.json as { value?: unknown }).value ?? "")
        : null;
    return {
      exists: true,
      value,
      status: value === "true" ? "OK" : "MISSING",
      notes: [],
    };
  }

  async createEnvironment(): Promise<void> {
    const planned = planEnvironmentWrite(
      emptyEnvironmentActual({ exists: false, status: "MISSING", name: RELEASE_ENVIRONMENT_NAME }),
    );
    if (planned.kind !== "CREATE") {
      throw new Error("internal: createEnvironment expected CREATE plan");
    }
    const put = this.exec(
      ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}`, "--input", "-"],
      planned.putBody,
    );
    if (!put.ok) {
      throw new Error(`create environment npm-release failed (HTTP ${put.status ?? "?"})`);
    }
    await this.ensureMainBranchPolicy();
  }

  async updateEnvironment(): Promise<void> {
    const current = await this.getEnvironment(RELEASE_ENVIRONMENT_NAME);
    const planned = planEnvironmentWrite(current);
    if (planned.kind === "STOP") {
      throw new Error(planned.reason);
    }
    if (planned.kind === "NOOP") return;
    if (planned.kind === "CREATE") {
      await this.createEnvironment();
      return;
    }
    if (planned.kind === "PUT_THEN_POST") {
      const put = this.exec(
        ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}`, "--input", "-"],
        planned.putBody,
      );
      if (!put.ok) {
        throw new Error(`update environment npm-release failed (HTTP ${put.status ?? "?"})`);
      }
    }
    await this.ensureMainBranchPolicy();
  }

  async createRuleset(): Promise<void> {
    const res = this.exec(
      ["-X", "POST", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets`, "--input", "-"],
      desiredRulesetPayload(),
    );
    if (!res.ok) {
      throw new Error(`create ruleset ${RELEASE_RULESET_NAME} failed (HTTP ${res.status ?? "?"})`);
    }
  }

  async updateRuleset(id: number): Promise<void> {
    const detail = this.exec(["-X", "GET", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets/${id}`]);
    if (!detail.ok) {
      const status = classifyGhReadFailure(detail.status);
      throw new Error(
        status === "AUTH_REQUIRED"
          ? `cannot read ruleset ${id} before UPDATE (401/403)`
          : `cannot read ruleset ${id} before UPDATE (HTTP ${detail.status ?? "?"})`,
      );
    }
    const snap = parseRulesetDetail(id, RELEASE_RULESET_NAME, detail.json);
    const payload = managedRulesetUpdatePayload(snap);
    if (!payload.ok) {
      throw new Error(payload.reason);
    }
    const res = this.exec(
      ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets/${id}`, "--input", "-"],
      payload.body,
    );
    if (!res.ok) {
      throw new Error(`update ruleset ${id} failed (HTTP ${res.status ?? "?"})`);
    }
  }

  async setReadyVariable(): Promise<void> {
    const existing = await this.getVariable(READY_VARIABLE_NAME);
    if (existing.exists) {
      const patch = this.exec(
        [
          "-X",
          "PATCH",
          `repos/${RELEASE_OWNER}/${RELEASE_REPO}/actions/variables/${READY_VARIABLE_NAME}`,
          "--input",
          "-",
        ],
        { name: READY_VARIABLE_NAME, value: "true" },
      );
      if (!patch.ok) {
        throw new Error(`set ${READY_VARIABLE_NAME} failed (HTTP ${patch.status ?? "?"})`);
      }
      return;
    }
    const create = this.exec(
      ["-X", "POST", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/actions/variables`, "--input", "-"],
      { name: READY_VARIABLE_NAME, value: "true" },
    );
    if (!create.ok) {
      throw new Error(`create ${READY_VARIABLE_NAME} failed (HTTP ${create.status ?? "?"})`);
    }
  }

  private async ensureMainBranchPolicy(): Promise<void> {
    const current = this.exec([
      "-X",
      "GET",
      `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}/deployment-branch-policies`,
    ]);
    if (!current.ok) {
      const status = classifyGhReadFailure(current.status);
      throw new Error(
        status === "AUTH_REQUIRED"
          ? "cannot read deployment branch policies before POST (401/403) — fail closed"
          : "cannot read deployment branch policies before POST — fail closed (no UPDATE on empty arrays)",
      );
    }
    const names: string[] = [];
    if (current.json && typeof current.json === "object") {
      const payload = current.json as { branch_policies?: { name?: string }[] };
      for (const p of payload.branch_policies ?? []) {
        if (p.name) names.push(p.name);
      }
    }
    if (names.includes("main")) return;
    const post = this.exec(
      [
        "-X",
        "POST",
        `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}/deployment-branch-policies`,
        "--input",
        "-",
      ],
      { name: "main", type: "branch" },
    );
    if (!post.ok) {
      throw new Error("failed to add main deployment-branch policy on npm-release");
    }
  }
}

/**
 * Normalize a GitHub REST ruleset detail body.
 * Tag-target `update` rules often omit `parameters` on read-back; keep that
 * shape. Writers still send `update_allows_fetch_and_merge: false`.
 */
export function parseRulesetDetail(id: number, name: string, json: unknown): RulesetSnapshot {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const conditions = body.conditions && typeof body.conditions === "object"
    ? (body.conditions as { ref_name?: { include?: string[] } })
    : {};
  const include = Array.isArray(conditions.ref_name?.include) ? conditions.ref_name.include : [];
  const rulesRaw = Array.isArray(body.rules) ? body.rules : [];
  const ruleObjects: RulesetRuleObject[] = [];
  for (const raw of rulesRaw) {
    if (!raw || typeof raw !== "object" || !("type" in raw)) continue;
    const type = String((raw as { type: unknown }).type);
    const parameters =
      "parameters" in raw &&
      (raw as { parameters: unknown }).parameters &&
      typeof (raw as { parameters: unknown }).parameters === "object"
        ? { ...(raw as { parameters: Record<string, unknown> }).parameters }
        : undefined;
    ruleObjects.push(parameters ? { type, parameters } : { type });
  }
  return {
    id,
    name,
    target: typeof body.target === "string" ? body.target : "",
    enforcement: typeof body.enforcement === "string" ? body.enforcement : "",
    include,
    rules: ruleObjects.map((r) => r.type),
    ruleObjects,
  };
}

/** Check-mode wrapper: every write throws. */
export function readOnlyGitHub(inner: GitHubControlPlaneClient): GitHubControlPlaneClient {
  const refuse = async (): Promise<never> => {
    throw new Error("release:setup --check is read-only; write refused");
  };
  return {
    verifyRepo: () => inner.verifyRepo(),
    getEnvironment: (name) => inner.getEnvironment(name),
    listRulesets: () => inner.listRulesets(),
    getVariable: (name) => inner.getVariable(name),
    createEnvironment: refuse,
    updateEnvironment: refuse,
    createRuleset: refuse,
    updateRuleset: refuse,
    setReadyVariable: refuse,
  };
}

export { RELEASE_OWNER, RELEASE_REPO };
