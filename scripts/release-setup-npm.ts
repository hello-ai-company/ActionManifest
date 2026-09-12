/**
 * Official npm CLI client for Trusted Publisher + package security discovery.
 *
 * NEVER runs registry publish / staged publish / staged approve / unpublish /
 * deprecate / dist-tag. NEVER stores or logs OTP / tokens / cookies.
 * Write paths require npm >= 11.15.0 (PINNED_NPM_CLI) — never a floating latest CLI.
 */
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { PINNED_NPM_CLI } from "./release-identity.js";
import {
  RELEASE_ENVIRONMENT_NAME,
  RELEASE_OWNER,
  RELEASE_REPO,
  TRUSTED_PUBLISHER_WORKFLOW,
  type PackageSecurityActual,
  type TrustedPublisherActual,
  type TrustedPublisherRecord,
  normalizeProvider,
} from "./release-setup-plan.js";

export interface NpmCliCapabilities {
  version: string;
  trust: boolean;
  trustList: boolean;
  trustGithub: boolean;
  access: boolean;
  accessSetMfa: boolean;
  stage: boolean;
  notes: string[];
}

export interface NpmTrustClient {
  inspectCli(): Promise<NpmCliCapabilities>;
  listTrustedPublisher(packageName: string): Promise<TrustedPublisherActual>;
  addTrustedPublisher(packageName: string): Promise<void>;
  getPackageSecurity(packageName: string): Promise<PackageSecurityActual>;
  applyAutomatableSecurity(packageName: string): Promise<void>;
}

export interface NpmExecResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type NpmExec = (args: string[], options?: { inheritStdio?: boolean }) => NpmExecResult;

const FORBIDDEN_NPM_ARGS = [
  ["publish"],
  ["stage", "publish"],
  ["stage", "approve"],
  ["stage", "reject"],
  ["unpublish"],
  ["deprecate"],
  ["dist-tag"],
  ["token"],
];

export function isForbiddenNpmArgv(args: string[]): boolean {
  if (args.includes("--otp") || args.some((a) => a.startsWith("--otp="))) return true;
  if (args.some((a) => a === "latest" && args[0] === "install")) return true;
  return FORBIDDEN_NPM_ARGS.some((seq) => seq.every((tok, i) => args[i] === tok));
}

export function parseNpmMajorMinorPatch(version: string): [number, number, number] | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

export function npmVersionAtLeast(actual: string, min: string): boolean {
  const a = parseNpmMajorMinorPatch(actual);
  const b = parseNpmMajorMinorPatch(min);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i]! > b[i]!) return true;
    if (a[i]! < b[i]!) return false;
  }
  return true;
}

export function defaultNpmExec(args: string[], options?: { inheritStdio?: boolean }): NpmExecResult {
  if (isForbiddenNpmArgv(args)) {
    return { status: 2, stdout: "", stderr: `refusing forbidden npm argv: ${args[0] ?? ""}` };
  }
  const spawnOpts: SpawnSyncOptions = {
    encoding: "utf8",
    env: {
      ...process.env,
      NPM_TOKEN: "",
      NODE_AUTH_TOKEN: "",
    },
  };
  if (options?.inheritStdio) {
    spawnOpts.stdio = "inherit";
  } else {
    spawnOpts.stdio = ["ignore", "pipe", "pipe"];
  }
  const r = spawnSync("npm", args, spawnOpts);
  return {
    status: r.status,
    stdout: typeof r.stdout === "string" ? r.stdout : "",
    stderr: typeof r.stderr === "string" ? r.stderr : "",
  };
}

export function helpMentions(help: string, token: string): boolean {
  return help.toLowerCase().includes(token.toLowerCase());
}

export function parseTrustedPublisherList(raw: unknown, packageName: string): TrustedPublisherRecord[] | "UNKNOWN" {
  if (raw == null) return [];
  const rows = extractPublisherRows(raw);
  if (rows === "UNKNOWN") return "UNKNOWN";
  const out: TrustedPublisherRecord[] = [];
  for (const row of rows) {
    const parsed = parseOnePublisher(row, packageName);
    if (parsed === "UNKNOWN") return "UNKNOWN";
    if (parsed) out.push(parsed);
  }
  return out;
}

function extractPublisherRows(raw: unknown): unknown[] | "UNKNOWN" {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== "object" || raw === null) return "UNKNOWN";
  const obj = raw as Record<string, unknown>;
  for (const key of ["trustedPublishers", "trusted_publishers", "publishers", "items", "data"]) {
    if (Array.isArray(obj[key])) return obj[key] as unknown[];
  }
  if ("provider" in obj || "repository" in obj || "oidcConfig" in obj || "id" in obj) {
    return [obj];
  }
  return "UNKNOWN";
}

function parseOnePublisher(row: unknown, _packageName: string): TrustedPublisherRecord | "UNKNOWN" | null {
  if (!row || typeof row !== "object") return "UNKNOWN";
  const r = row as Record<string, unknown>;
  const nested =
    r.oidcConfig && typeof r.oidcConfig === "object" ? (r.oidcConfig as Record<string, unknown>) : {};
  const provider = String(r.provider ?? r.issuer ?? nested.provider ?? nested.issuer ?? "");
  const repository = String(
    r.repository ?? r.repo ?? nested.repository ?? nested.repo ?? "",
  );
  let org = String(r.org ?? r.owner ?? r.organization ?? nested.org ?? nested.owner ?? "");
  let repo = String(r.repoName ?? nested.repoName ?? "");
  if (!org && repository.includes("/")) {
    const [o, rest] = repository.split("/");
    org = o ?? "";
    repo = rest ?? "";
  }
  if (!repo && repository.includes("/")) {
    repo = repository.split("/").slice(1).join("/");
  }
  const workflow = String(
    r.workflow_filename ??
      r.workflowFilename ??
      r.file ??
      r.workflow ??
      nested.workflow_filename ??
      nested.workflowFilename ??
      nested.file ??
      nested.workflow ??
      "",
  );
  const environment = String(
    r.environment ?? r.env ?? nested.environment ?? nested.env ?? "",
  );
  const perms = r.permissions ?? nested.permissions;
  const { allowPublish, allowStagePublish, known } = parsePermissions(perms, r);
  if (!provider || !org || !repo || !workflow) return "UNKNOWN";
  if (!known) return "UNKNOWN";
  return {
    id: typeof r.id === "string" ? r.id : undefined,
    provider: normalizeProvider(provider),
    org,
    repo,
    workflow,
    environment,
    allowStagePublish,
    allowPublish,
  };
}

function parsePermissions(
  perms: unknown,
  row: Record<string, unknown>,
): { allowPublish: boolean; allowStagePublish: boolean; known: boolean } {
  if (typeof row.allowPublish === "boolean" || typeof row.allow_publish === "boolean") {
    return {
      allowPublish: Boolean(row.allowPublish ?? row.allow_publish),
      allowStagePublish: Boolean(row.allowStagePublish ?? row.allow_stage_publish ?? row.allow_staged_publish),
      known: true,
    };
  }
  if (Array.isArray(perms)) {
    const tokens = perms.map((p) => String(p).toLowerCase());
    return {
      allowPublish: tokens.some((t) => t === "publish" || t === "npm-publish" || t === "allow-publish"),
      allowStagePublish: tokens.some(
        (t) => t.includes("stage") && t.includes("publish") || t === "stage" || t === "stage-publish",
      ),
      known: true,
    };
  }
  if (perms && typeof perms === "object") {
    const p = perms as Record<string, unknown>;
    const publish = Boolean(p.publish ?? p["npm-publish"] ?? p.allowPublish);
    const stage = Boolean(
      p.stage ?? p["stage-publish"] ?? p["stage_publish"] ?? p.allowStagePublish ?? p["npm-stage"],
    );
    return { allowPublish: publish, allowStagePublish: stage, known: true };
  }
  return { allowPublish: false, allowStagePublish: false, known: false };
}

export class OfficialNpmTrustClient implements NpmTrustClient {
  constructor(private readonly exec: NpmExec = defaultNpmExec) {}

  async inspectCli(): Promise<NpmCliCapabilities> {
    const ver = this.exec(["--version"]);
    const version = (ver.stdout || "").trim();
    const trust = this.exec(["help", "trust"]);
    const access = this.exec(["help", "access"]);
    const stage = this.exec(["help", "stage"]);
    const trustHelp = `${trust.stdout}\n${trust.stderr}`;
    const accessHelp = `${access.stdout}\n${access.stderr}`;
    const stageHelp = `${stage.stdout}\n${stage.stderr}`;
    const notes: string[] = [`npm --version ${version || "UNKNOWN"}`];
    if (!version) notes.push("npm --version produced no output");
    return {
      version,
      trust: helpMentions(trustHelp, "npm trust") && !helpMentions(trustHelp, "unknown command"),
      trustList: helpMentions(trustHelp, "trust list"),
      trustGithub: helpMentions(trustHelp, "trust github"),
      access: helpMentions(accessHelp, "npm access") && !helpMentions(accessHelp, "unknown command"),
      accessSetMfa: helpMentions(accessHelp, "set mfa"),
      stage: helpMentions(stageHelp, "npm stage") && !helpMentions(stageHelp, "unknown command"),
      notes,
    };
  }

  async listTrustedPublisher(packageName: string): Promise<TrustedPublisherActual> {
    const caps = await this.inspectCli();
    if (!caps.trust || !caps.trustList) {
      return {
        packageName,
        exists: false,
        status: "UNSUPPORTED",
        notes: [
          `official npm CLI ${caps.version || "UNKNOWN"} has no \`npm trust list\` (need >= ${PINNED_NPM_CLI}) — never fake PASS`,
        ],
      };
    }
    const r = this.exec([
      "trust",
      "list",
      packageName,
      "--json",
      "--registry",
      "https://registry.npmjs.org/",
    ]);
    const blob = `${r.stdout}\n${r.stderr}`;
    if (r.status !== 0) {
      if (/ENEEDAUTH|not logged in|401|EOTP|two-factor|2fa/i.test(blob)) {
        return {
          packageName,
          exists: false,
          status: "AUTH_REQUIRED",
          notes: ["npm trust list requires maintainer auth (interactive 2FA allowed; one-time codes never stored)"],
        };
      }
      if (/404|E404|not found/i.test(blob)) {
        return { packageName, exists: false, status: "MISSING", notes: ["no Trusted Publisher"] };
      }
      return {
        packageName,
        exists: false,
        status: "UNKNOWN",
        notes: ["npm trust list failed — never fake PASS"],
      };
    }
    let parsedJson: unknown = null;
    try {
      parsedJson = JSON.parse(r.stdout || "null");
    } catch {
      return {
        packageName,
        exists: false,
        status: "UNKNOWN",
        notes: ["npm trust list --json was not JSON — never fake PASS"],
      };
    }
    const records = parseTrustedPublisherList(parsedJson, packageName);
    if (records === "UNKNOWN") {
      return {
        packageName,
        exists: false,
        status: "UNKNOWN",
        notes: ["Trusted Publisher payload could not be parsed confidently — never fake PASS"],
      };
    }
    if (records.length === 0) {
      return { packageName, exists: false, status: "MISSING", notes: ["no Trusted Publisher"] };
    }
    if (records.length > 1) {
      return {
        packageName,
        exists: true,
        publisher: records[0],
        status: "DRIFTED",
        notes: ["multiple Trusted Publisher records — STOP / security review"],
      };
    }
    return {
      packageName,
      exists: true,
      publisher: records[0],
      status: "OK",
      notes: [],
    };
  }

  async addTrustedPublisher(packageName: string): Promise<void> {
    const caps = await this.inspectCli();
    if (!caps.trustGithub || !npmVersionAtLeast(caps.version, PINNED_NPM_CLI)) {
      throw new Error(
        `refusing Trusted Publisher write: official npm CLI must be >= ${PINNED_NPM_CLI} with \`npm trust github\` (got ${caps.version || "UNKNOWN"}; never a floating latest CLI)`,
      );
    }
    const args = [
      "trust",
      "github",
      packageName,
      "--file",
      TRUSTED_PUBLISHER_WORKFLOW,
      "--repo",
      `${RELEASE_OWNER}/${RELEASE_REPO}`,
      "--environment",
      RELEASE_ENVIRONMENT_NAME,
      "--allow-stage-publish",
      "--registry",
      "https://registry.npmjs.org/",
    ];
    if (args.includes("--allow-publish") || args.includes("publish") && args[1] !== "github") {
      throw new Error("internal: refusing a Trusted Publisher write that enables direct publish");
    }
    // inheritStdio: maintainer 2FA / WebAuthn prompt is allowed; we never pass --otp.
    const r = this.exec(args, { inheritStdio: true });
    if (r.status !== 0) {
      throw new Error(`npm trust github failed for ${packageName} (exit ${r.status ?? "?"})`);
    }
  }

  async getPackageSecurity(packageName: string): Promise<PackageSecurityActual> {
    const caps = await this.inspectCli();
    const tp = await this.listTrustedPublisher(packageName);
    const trustedPublishingUsed: boolean | "UNKNOWN" =
      tp.status === "OK" && tp.exists ? true : tp.status === "MISSING" ? false : "UNKNOWN";
    if (!caps.access) {
      return {
        packageName,
        twoFactorRequired: "UNKNOWN",
        longLivedTokensDisallowed: "UNKNOWN",
        trustedPublishingUsed,
        status: "UNSUPPORTED",
        notes: [
          "official npm CLI has no inspectable `npm access` security surface for token-disallow — MANUAL_REQUIRED / never fake PASS",
        ],
      };
    }
    // `npm access set mfa=` can express publish-time 2FA; "disallow tokens" is
    // documented as an npmjs.com package Settings control (UI / break-glass).
    const accessGet = this.exec([
      "access",
      "list",
      "collaborators",
      packageName,
      "--json",
      "--registry",
      "https://registry.npmjs.org/",
    ]);
    if (accessGet.status !== 0) {
      const blob = `${accessGet.stdout}\n${accessGet.stderr}`;
      if (/ENEEDAUTH|401|not logged in|EOTP|2fa/i.test(blob)) {
        return {
          packageName,
          twoFactorRequired: "UNKNOWN",
          longLivedTokensDisallowed: "UNKNOWN",
          trustedPublishingUsed,
          status: "AUTH_REQUIRED",
          notes: ["npm access requires maintainer auth"],
        };
      }
    }
    return {
      packageName,
      twoFactorRequired: "UNKNOWN",
      longLivedTokensDisallowed: "UNKNOWN",
      trustedPublishingUsed,
      status: "MANUAL_REQUIRED",
      notes: [
        "package publishing-access 'require 2FA and disallow tokens' is not a safely documented official CLI write — MANUAL_REQUIRED (UI break-glass). Trusted Publishing used is derived from npm trust list.",
      ],
    };
  }

  async applyAutomatableSecurity(_packageName: string): Promise<void> {
    // Token-disallow + account 2FA PoP are not official safe CLI writes.
    throw new Error(
      "no automatable official npm security write (token-disallow is MANUAL_REQUIRED; 2FA PoP is human)",
    );
  }
}

/** Check-mode wrapper: every write throws. */
export function readOnlyNpm(inner: NpmTrustClient): NpmTrustClient {
  const refuse = async (): Promise<never> => {
    throw new Error("release:setup --check is read-only; write refused");
  };
  return {
    inspectCli: () => inner.inspectCli(),
    listTrustedPublisher: (pkg) => inner.listTrustedPublisher(pkg),
    addTrustedPublisher: refuse,
    getPackageSecurity: (pkg) => inner.getPackageSecurity(pkg),
    applyAutomatableSecurity: refuse,
  };
}
