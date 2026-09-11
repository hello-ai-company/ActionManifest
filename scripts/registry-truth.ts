/**
 * Registry READ truth for release verification.
 *
 * CLI timeout / network failure is NEVER a publish failure. Packument lag
 * after a first scoped publish is PROPAGATING — never a reason to republish.
 * This module performs GET-only operations against registry.npmjs.org.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { CANONICAL_REGISTRY, RC0_HISTORICAL_LATEST, distTagForVersion, isPrerelease } from "./release-identity.js";

export type RegistryState =
  | "PUBLISHED_VERIFIED"
  | "ABSENT"
  | "PROPAGATING"
  | "INCONSISTENT"
  | "UNKNOWN";

export interface PackumentProbe {
  state: "ok" | "notfound" | "timeout" | "network" | "parse";
  stdout: string;
  attempts: number;
}

export interface DistTags {
  latest?: string;
  next?: string;
  [name: string]: string | undefined;
}

export interface PackageRegistryReport {
  name: string;
  version: string;
  state: RegistryState;
  dist_tags: DistTags;
  registry_sha256?: string;
  canonical_sha256?: string;
  notes: string[];
}

export interface RegistryVerifyOptions {
  /** Exact version to verify (never the bare package name / latest). */
  version: string;
  registry?: string;
  /** canonical name → sha256 from the Release Check artifact. */
  canonicalSha256: Map<string, string>;
  /** Bounded packument retries (default 5). */
  retries?: number;
  /** Per-attempt timeout ms (default 15_000). */
  timeoutMs?: number;
  /** Injected packument reader (tests). */
  readPackument?: (name: string, attempt: number) => PackumentProbe;
  /** Injected tarball downloader (tests). */
  downloadTarball?: (url: string) => { error?: string; bytes?: Buffer };
}

export const DEFAULT_PACKUMENT_RETRIES = 5;
export const DEFAULT_PACKUMENT_TIMEOUT_MS = 15_000;

export function classifyPackumentError(message: string, stderr = ""): PackumentProbe["state"] {
  const text = `${message}\n${stderr}`;
  if (/E404|404 Not Found|code E404|error:\s*404|\b404\b/i.test(text)) return "notfound";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|TIMEOUT|max-time/i.test(text)) return "timeout";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|network|EAI_AGAIN|socket hang up/i.test(text)) {
    return "network";
  }
  return "parse";
}

/**
 * Bounded read retries. 404 on a brand-new scoped name is PROPAGATING, not
 * ABSENT, until retries are exhausted — then ABSENT. Timeouts stay UNKNOWN.
 */
export function probePackumentWithRetries(
  read: (attempt: number) => PackumentProbe,
  retries = DEFAULT_PACKUMENT_RETRIES,
): PackumentProbe {
  let last: PackumentProbe = { state: "network", stdout: "", attempts: 0 };
  for (let attempt = 1; attempt <= retries; attempt++) {
    last = { ...read(attempt), attempts: attempt };
    if (last.state === "ok") return last;
    if (last.state === "timeout" || last.state === "network" || last.state === "parse") {
      // Keep retrying transient / unknown reads; never treat as publish failure.
      continue;
    }
    if (last.state === "notfound") {
      // Packument lag: retry. Exhaustion is handled by the caller.
      continue;
    }
  }
  return last;
}

export function sha256Buffer(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Dist-tag policy check. Does NOT mutate tags.
 * Prerelease: require next === version. The rc.0 latest=version observation
 * is recorded, never treated as a defect to auto-repair.
 * Stable: require latest === version.
 */
export function evaluateDistTags(
  version: string,
  tags: DistTags,
): { ok: boolean; notes: string[] } {
  const notes: string[] = [];
  const expected = distTagForVersion(version);
  if (isPrerelease(version)) {
    if (tags.next !== version) {
      return { ok: false, notes: [`prerelease requires dist-tags.next=${version}, got ${tags.next ?? "(absent)"}`] };
    }
    notes.push(`prerelease dist-tag next=${version} (policy ok)`);
    if (tags.latest === version && version === RC0_HISTORICAL_LATEST) {
      notes.push(
        `HISTORICAL: latest=${version} was set by the first publish of rc.0; documented only — do not auto-repair`,
      );
    }
    return { ok: true, notes };
  }
  if (tags.latest !== version) {
    return { ok: false, notes: [`stable requires dist-tags.latest=${version}, got ${tags.latest ?? "(absent)"}`] };
  }
  notes.push(`stable dist-tag latest=${version} (policy ok)`);
  return { ok: true, notes };
}

export function decidePackageState(args: {
  packument: PackumentProbe;
  version: string;
  versionPresent: boolean;
  shaMatch: boolean | undefined;
  distTagOk: boolean | undefined;
}): RegistryState {
  if (args.packument.state === "timeout" || args.packument.state === "network" || args.packument.state === "parse") {
    return "UNKNOWN";
  }
  if (args.packument.state === "notfound") {
    // probePackumentWithRetries only returns notfound after retries are
    // exhausted. Mid-retry 404s are not surfaced — they are packument lag.
    return "ABSENT";
  }
  if (!args.versionPresent) return "PROPAGATING";
  if (args.shaMatch === false || args.distTagOk === false) return "INCONSISTENT";
  if (args.shaMatch === true && args.distTagOk === true) return "PUBLISHED_VERIFIED";
  return "UNKNOWN";
}

interface PackumentJson {
  versions?: Record<string, { dist?: { tarball?: string } }>;
  "dist-tags"?: DistTags;
}

export function evaluatePackageReport(
  name: string,
  opts: RegistryVerifyOptions,
  packument: PackumentProbe,
  parsed: PackumentJson | undefined,
  tarballBytes: Buffer | undefined,
): PackageRegistryReport {
  const notes: string[] = [];
  const tags = parsed?.["dist-tags"] ?? {};
  const versionEntry = parsed?.versions?.[opts.version];
  const versionPresent = Boolean(versionEntry);
  const canonical = opts.canonicalSha256.get(name);
  let registrySha: string | undefined;
  let shaMatch: boolean | undefined;
  if (tarballBytes) {
    registrySha = sha256Buffer(tarballBytes);
    if (canonical) {
      shaMatch = registrySha === canonical;
      if (!shaMatch) {
        notes.push(`registry sha256 ${registrySha} != canonical ${canonical}`);
      }
    }
  }
  let distTagOk: boolean | undefined;
  if (versionPresent) {
    const ev = evaluateDistTags(opts.version, tags);
    distTagOk = ev.ok;
    notes.push(...ev.notes);
  }
  if (packument.state === "timeout") {
    notes.push("registry READ timed out — this is NOT a publish failure; do not republish");
  }
  if (packument.state === "notfound" && packument.attempts > 1) {
    notes.push(
      `packument 404 after ${packument.attempts} bounded reads — likely propagation; do not republish solely for lag`,
    );
  }
  const state = decidePackageState({
    packument,
    version: opts.version,
    versionPresent,
    shaMatch,
    distTagOk,
  });
  return {
    name,
    version: opts.version,
    state,
    dist_tags: tags,
    registry_sha256: registrySha,
    canonical_sha256: canonical,
    notes,
  };
}

/** Full packument URL (versions is a map). `npm view` alone is the latest document. */
export function packumentUrl(name: string, registry = CANONICAL_REGISTRY): string {
  const encoded = name.replace("/", "%2f");
  return `${registry.replace(/\/$/, "")}/${encoded}`;
}

function defaultReadPackument(name: string, timeoutMs: number, registry: string): PackumentProbe {
  try {
    const stdout = execFileSync(
      "curl",
      [
        "-fsSL",
        "-H",
        "Accept: application/json",
        "--max-time",
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        packumentUrl(name, registry),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs + 1000 },
    );
    return { state: "ok", stdout, attempts: 1 };
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "");
    const message = String((e as Error).message ?? "");
    return { state: classifyPackumentError(message, stderr), stdout: "", attempts: 1 };
  }
}

function defaultDownloadTarball(url: string, timeoutMs: number): { error?: string; bytes?: Buffer } {
  try {
    const bytes = execFileSync("curl", ["-fsSL", "--max-time", String(Math.ceil(timeoutMs / 1000)), url], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: timeoutMs + 1000,
    }) as Buffer;
    return { bytes };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

export function verifyPackagesOnRegistry(
  names: readonly string[],
  opts: RegistryVerifyOptions,
): { reports: PackageRegistryReport[]; overall: RegistryState } {
  const retries = opts.retries ?? DEFAULT_PACKUMENT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PACKUMENT_TIMEOUT_MS;
  const reports: PackageRegistryReport[] = [];
  for (const name of names) {
    const registry = opts.registry ?? CANONICAL_REGISTRY;
    const read =
      opts.readPackument ??
      ((_n: string, _attempt: number) => defaultReadPackument(name, timeoutMs, registry));
    const packument = probePackumentWithRetries((attempt) => read(name, attempt), retries);
    let parsed: PackumentJson | undefined;
    if (packument.state === "ok") {
      try {
        parsed = JSON.parse(packument.stdout) as PackumentJson;
      } catch {
        reports.push(
          evaluatePackageReport(
            name,
            opts,
            { ...packument, state: "parse" },
            undefined,
            undefined,
          ),
        );
        continue;
      }
    }
    let bytes: Buffer | undefined;
    const tarballUrl = parsed?.versions?.[opts.version]?.dist?.tarball;
    if (tarballUrl && packument.state === "ok") {
      const dl = (opts.downloadTarball ?? ((url) => defaultDownloadTarball(url, timeoutMs)))(tarballUrl);
      if (dl.bytes) bytes = dl.bytes;
    }
    reports.push(evaluatePackageReport(name, opts, packument, parsed, bytes));
  }
  const states = new Set(reports.map((r) => r.state));
  let overall: RegistryState = "PUBLISHED_VERIFIED";
  if (states.has("UNKNOWN")) overall = "UNKNOWN";
  else if (states.has("INCONSISTENT")) overall = "INCONSISTENT";
  else if (states.has("PROPAGATING")) overall = "PROPAGATING";
  else if (states.has("ABSENT")) overall = "ABSENT";
  return { reports, overall };
}

export { CANONICAL_REGISTRY };
