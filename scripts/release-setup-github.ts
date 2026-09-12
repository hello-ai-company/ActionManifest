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
  RELEASE_TAG_INCLUDE,
  READY_VARIABLE_NAME,
  MANAGED_RULESET_RULES,
  type GitHubEnvironmentActual,
  type ReadyVariableActual,
  type RepoIdentityActual,
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

function env404(name: string): GitHubEnvironmentActual {
  return {
    exists: false,
    name,
    deploymentBranches: [],
    requiredReviewerCount: 0,
    secretNames: [],
    status: "MISSING",
    notes: [`environment ${name} does not exist`],
  };
}

function desiredRulesetBody(): Record<string, unknown> {
  return {
    name: RELEASE_RULESET_NAME,
    target: "tag",
    enforcement: "active",
    conditions: {
      ref_name: {
        include: [RELEASE_TAG_INCLUDE],
        exclude: [],
      },
    },
    rules: MANAGED_RULESET_RULES.map((type) => ({ type })),
  };
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
    if (!envRes.ok) {
      if (envRes.status === 404 || /Not Found|404/i.test(envRes.stderr + envRes.stdout)) {
        return env404(name);
      }
      if (envRes.status === 401 || envRes.status === 403) {
        return {
          exists: false,
          name,
          deploymentBranches: [],
          requiredReviewerCount: 0,
          secretNames: [],
          status: "AUTH_REQUIRED",
          notes: ["cannot read GitHub Environment (401/403)"],
        };
      }
      return {
        exists: false,
        name,
        deploymentBranches: [],
        requiredReviewerCount: 0,
        secretNames: [],
        status: "UNKNOWN",
        notes: ["cannot read GitHub Environment"],
      };
    }
    const body = (envRes.json ?? {}) as {
      name?: string;
      protection_rules?: { type?: string; reviewers?: unknown[] }[];
      deployment_branch_policy?: { custom_branch_policies?: boolean; protected_branches?: boolean };
    };
    const reviewers = (body.protection_rules ?? []).find((r) => r.type === "required_reviewers");
    const branchRes = this.exec([
      "-X",
      "GET",
      `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${name}/deployment-branch-policies`,
    ]);
    const branchNames: string[] = [];
    if (branchRes.ok && branchRes.json && typeof branchRes.json === "object") {
      const payload = branchRes.json as { branch_policies?: { name?: string }[] };
      for (const p of payload.branch_policies ?? []) {
        if (p.name) branchNames.push(p.name);
      }
    }
    const secretRes = this.exec([
      "-X",
      "GET",
      `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${name}/secrets`,
    ]);
    const secretNames: string[] = [];
    if (secretRes.ok && secretRes.json && typeof secretRes.json === "object") {
      const payload = secretRes.json as { secrets?: { name?: string }[] };
      for (const s of payload.secrets ?? []) {
        if (s.name) secretNames.push(s.name);
      }
    }
    return {
      exists: true,
      name: body.name ?? name,
      deploymentBranches: branchNames,
      requiredReviewerCount: Array.isArray(reviewers?.reviewers) ? reviewers.reviewers.length : 0,
      secretNames,
      status: "OK",
      notes: [],
    };
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
    const put = this.exec(
      ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}`, "--input", "-"],
      {
        wait_timer: 0,
        deployment_branch_policy: {
          protected_branches: false,
          custom_branch_policies: true,
        },
      },
    );
    if (!put.ok) {
      throw new Error(`create environment npm-release failed (HTTP ${put.status ?? "?"})`);
    }
    await this.ensureMainBranchPolicy();
  }

  async updateEnvironment(): Promise<void> {
    const current = await this.getEnvironment(RELEASE_ENVIRONMENT_NAME);
    if (!current.exists) {
      await this.createEnvironment();
      return;
    }
    if (!current.deploymentBranches.includes("main")) {
      const put = this.exec(
        ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/environments/${RELEASE_ENVIRONMENT_NAME}`, "--input", "-"],
        {
          wait_timer: 0,
          deployment_branch_policy: {
            protected_branches: false,
            custom_branch_policies: true,
          },
        },
      );
      if (!put.ok) {
        throw new Error(`update environment npm-release failed (HTTP ${put.status ?? "?"})`);
      }
      await this.ensureMainBranchPolicy();
    }
  }

  async createRuleset(): Promise<void> {
    const res = this.exec(
      ["-X", "POST", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets`, "--input", "-"],
      desiredRulesetBody(),
    );
    if (!res.ok) {
      throw new Error(`create ruleset ${RELEASE_RULESET_NAME} failed (HTTP ${res.status ?? "?"})`);
    }
  }

  async updateRuleset(id: number): Promise<void> {
    const res = this.exec(
      ["-X", "PUT", `repos/${RELEASE_OWNER}/${RELEASE_REPO}/rulesets/${id}`, "--input", "-"],
      desiredRulesetBody(),
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
    const names: string[] = [];
    if (current.ok && current.json && typeof current.json === "object") {
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

export function parseRulesetDetail(id: number, name: string, json: unknown): RulesetSnapshot {
  const body = json && typeof json === "object" ? (json as Record<string, unknown>) : {};
  const conditions = body.conditions && typeof body.conditions === "object"
    ? (body.conditions as { ref_name?: { include?: string[] } })
    : {};
  const include = Array.isArray(conditions.ref_name?.include) ? conditions.ref_name.include : [];
  const rulesRaw = Array.isArray(body.rules) ? body.rules : [];
  const rules = rulesRaw
    .map((r) => (r && typeof r === "object" && "type" in r ? String((r as { type: unknown }).type) : ""))
    .filter(Boolean);
  return {
    id,
    name,
    target: typeof body.target === "string" ? body.target : "",
    enforcement: typeof body.enforcement === "string" ? body.enforcement : "",
    include,
    rules,
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
