/**
 * Registry READ truth for release verification.
 *
 * Three independent HTTP GET sources (npm view is NEVER primary truth):
 *   1) Exact version  GET /@scope%2Fpkg/<version>
 *   2) Dist-tags      GET /-/package/@scope%2Fpkg/dist-tags
 *   3) Root packument GET /@scope%2Fpkg
 *
 * CLI timeout / network / parse failure is NEVER a publish failure.
 * exact=200 + root=404 is PROPAGATING (rc.0 packument-lag pattern).
 * This module performs GET-only operations against registry.npmjs.org.
 * No auto-repair, no publish, no dist-tag mutation.
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

export type IndependentSource = "exact" | "dist-tags" | "root";

export interface RegistryRead {
  source: IndependentSource;
  url: string;
  status: number | null;
  state: "ok" | "notfound" | "timeout" | "network" | "parse";
  stdout: string;
  attempts: number;
  exhausted404: boolean;
}

/** @deprecated Use RegistryRead. Kept for existing call sites during the split. */
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
  sources?: {
    exact: { status: number | null; state: RegistryRead["state"] };
    distTags: { status: number | null; state: RegistryRead["state"] };
    root: { status: number | null; state: RegistryRead["state"] };
  };
}

export interface RegistryVerifyOptions {
  /** Exact version to verify (never the bare package name / latest). */
  version: string;
  registry?: string;
  /** canonical name → sha256 from the Release Check artifact. */
  canonicalSha256: Map<string, string>;
  /** Bounded per-source retries (default 5). */
  retries?: number;
  /** Per-attempt timeout ms (default 15_000). */
  timeoutMs?: number;
  /** Injected reader for any of the three independent URLs (tests). */
  readRegistry?: (url: string, attempt: number) => Omit<RegistryRead, "source" | "exhausted404" | "attempts"> & {
    attempts?: number;
  };
  /** Injected tarball downloader (tests). */
  downloadTarball?: (url: string) => { error?: string; bytes?: Buffer };
}

export const DEFAULT_PACKUMENT_RETRIES = 5;
export const DEFAULT_PACKUMENT_TIMEOUT_MS = 15_000;

export function encodeScopedPackage(name: string): string {
  return name.replace("/", "%2F");
}

export function packumentUrl(name: string, registry = CANONICAL_REGISTRY): string {
  return `${registry.replace(/\/$/, "")}/${encodeScopedPackage(name)}`;
}

export function exactVersionUrl(
  name: string,
  version: string,
  registry = CANONICAL_REGISTRY,
): string {
  return `${packumentUrl(name, registry)}/${encodeURIComponent(version)}`;
}

export function distTagsUrl(name: string, registry = CANONICAL_REGISTRY): string {
  return `${registry.replace(/\/$/, "")}/-/package/${encodeScopedPackage(name)}/dist-tags`;
}

export function classifyPackumentError(message: string, stderr = ""): RegistryRead["state"] {
  const text = `${message}\n${stderr}`;
  if (/E404|404 Not Found|code E404|error:\s*404|\b404\b/i.test(text)) return "notfound";
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|timeout|TIMEOUT|timed out|max-time/i.test(text)) return "timeout";
  if (/ENOTFOUND|ECONNRESET|ECONNREFUSED|network|EAI_AGAIN|socket hang up/i.test(text)) {
    return "network";
  }
  return "parse";
}

/**
 * Bounded read retries per independent source. 404 is retried (propagation).
 * Exhaustion is recorded on the returned read; the classifier decides ABSENT
 * vs PROPAGATING from the trio. Timeouts stay UNKNOWN.
 */
export function probeRegistryWithRetries(
  read: (attempt: number) => Omit<RegistryRead, "exhausted404">,
  retries = DEFAULT_PACKUMENT_RETRIES,
): RegistryRead {
  let last: RegistryRead = {
    source: "root",
    url: "",
    status: null,
    state: "network",
    stdout: "",
    attempts: 0,
    exhausted404: false,
  };
  for (let attempt = 1; attempt <= retries; attempt++) {
    const got = read(attempt);
    last = {
      ...got,
      attempts: attempt,
      exhausted404: got.state === "notfound" && attempt >= retries,
    };
    if (last.state === "ok") return { ...last, exhausted404: false };
    // Retry timeout / network / parse / notfound. Never publish to "fix" lag.
  }
  return last;
}

/** @deprecated Use probeRegistryWithRetries. */
export function probePackumentWithRetries(
  read: (attempt: number) => PackumentProbe,
  retries = DEFAULT_PACKUMENT_RETRIES,
): PackumentProbe {
  const result = probeRegistryWithRetries((attempt) => {
    const probe = read(attempt);
    return {
      source: "root",
      url: "",
      status: probe.state === "notfound" ? 404 : probe.state === "ok" ? 200 : null,
      state: probe.state,
      stdout: probe.stdout,
      attempts: attempt,
    };
  }, retries);
  return { state: result.state, stdout: result.stdout, attempts: result.attempts };
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
  if (tags[expected] !== version) {
    return {
      ok: false,
      notes: [
        `${isPrerelease(version) ? "prerelease" : "stable"} requires dist-tags.${expected}=${version}, got ${tags[expected] ?? "(absent)"}`,
      ],
    };
  }
  notes.push(
    `${isPrerelease(version) ? "prerelease" : "stable"} dist-tag ${expected}=${version} (policy ok)`,
  );
  if (isPrerelease(version) && tags.latest === version && version === RC0_HISTORICAL_LATEST) {
    notes.push(
      `HISTORICAL: latest=${version} was set by the first publish of rc.0; documented only — do not auto-repair`,
    );
  }
  return { ok: true, notes };
}

export function classifyThreeSourceTruth(args: {
  exact: RegistryRead;
  distTags: RegistryRead;
  root: RegistryRead;
  version: string;
  shaMatch: boolean | undefined;
}): { state: RegistryState; notes: string[]; dist_tags: DistTags } {
  const notes: string[] = [];
  const { exact, distTags, root } = args;
  const transient = (r: RegistryRead) =>
    r.state === "timeout" || r.state === "network" || r.state === "parse";
  if (transient(exact) || transient(distTags) || transient(root)) {
    if (exact.state === "timeout" || distTags.state === "timeout" || root.state === "timeout") {
      notes.push("registry READ timed out — this is NOT a publish failure; do not republish");
    } else if (exact.state === "parse" || distTags.state === "parse" || root.state === "parse") {
      notes.push("registry READ parse failure — this is NOT a publish failure; do not republish");
    } else {
      notes.push("registry READ network failure — this is NOT a publish failure; do not republish");
    }
    return { state: "UNKNOWN", notes, dist_tags: parseDistTags(distTags) };
  }

  const exact200 = exact.state === "ok";
  const exact404 = exact.state === "notfound";
  const root200 = root.state === "ok";
  const root404 = root.state === "notfound";
  const tags = parseDistTags(distTags);

  // rc.0 / scoped first-publish pattern: version document exists, root lags.
  if (exact200 && root404) {
    notes.push(
      "exact version 200 + root packument 404 — PROPAGATING (packument lag; do not republish)",
    );
    return { state: "PROPAGATING", notes, dist_tags: tags };
  }

  if (exact404 && root404) {
    if (root.exhausted404 || exact.exhausted404) {
      if (distTags.state === "ok") {
        notes.push("exact+root 404 but dist-tags 200 — INCONSISTENT (do not auto-repair tags)");
        return { state: "INCONSISTENT", notes, dist_tags: tags };
      }
      notes.push(
        `exact+root exhausted 404 after ${Math.max(exact.attempts, root.attempts)} bounded reads — ABSENT`,
      );
      return { state: "ABSENT", notes, dist_tags: tags };
    }
    notes.push("exact+root 404 without exhausted retries — PROPAGATING");
    return { state: "PROPAGATING", notes, dist_tags: tags };
  }

  if (exact404 && root200) {
    notes.push("exact version 404 but root packument 200 — INCONSISTENT");
    return { state: "INCONSISTENT", notes, dist_tags: tags };
  }

  if (exact200 && root200) {
    const ev = evaluateDistTags(args.version, tags);
    notes.push(...ev.notes);
    if (args.shaMatch === false || ev.ok === false) {
      return { state: "INCONSISTENT", notes, dist_tags: tags };
    }
    if (args.shaMatch === true && ev.ok === true) {
      return { state: "PUBLISHED_VERIFIED", notes, dist_tags: tags };
    }
    notes.push("exact+root 200 but SHA evidence incomplete — UNKNOWN (do not republish)");
    return { state: "UNKNOWN", notes, dist_tags: tags };
  }

  notes.push("incomplete independent-source combination — UNKNOWN");
  return { state: "UNKNOWN", notes, dist_tags: tags };
}

function parseDistTags(read: RegistryRead): DistTags {
  if (read.state !== "ok" || !read.stdout) return {};
  try {
    const parsed = JSON.parse(read.stdout) as DistTags | { "dist-tags"?: DistTags };
    if (parsed && typeof parsed === "object" && "dist-tags" in parsed && parsed["dist-tags"]) {
      return parsed["dist-tags"];
    }
    if (parsed && typeof parsed === "object") {
      const out: DistTags = {};
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === "string") out[k] = v;
      }
      return out;
    }
  } catch {
    return {};
  }
  return {};
}

interface VersionDoc {
  version?: string;
  dist?: { tarball?: string };
  versions?: Record<string, { dist?: { tarball?: string } }>;
  "dist-tags"?: DistTags;
}

function tarballUrlFromExactOrRoot(
  version: string,
  exact: RegistryRead,
  root: RegistryRead,
): string | undefined {
  if (exact.state === "ok") {
    try {
      const doc = JSON.parse(exact.stdout) as VersionDoc;
      if (doc.dist?.tarball) return doc.dist.tarball;
    } catch {
      /* classified elsewhere */
    }
  }
  if (root.state === "ok") {
    try {
      const doc = JSON.parse(root.stdout) as VersionDoc;
      if (doc.versions?.[version]?.dist?.tarball) return doc.versions[version]?.dist?.tarball;
    } catch {
      /* classified elsewhere */
    }
  }
  return undefined;
}

function defaultHttpGet(url: string, timeoutMs: number): Omit<RegistryRead, "source" | "exhausted404" | "attempts"> {
  try {
    const stdout = execFileSync(
      "curl",
      [
        "-sS",
        "-H",
        "Accept: application/json",
        "--max-time",
        String(Math.max(1, Math.ceil(timeoutMs / 1000))),
        "-w",
        "\n__HTTP_STATUS__%{http_code}",
        url,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: timeoutMs + 1000 },
    );
    const marker = "\n__HTTP_STATUS__";
    const idx = stdout.lastIndexOf(marker);
    if (idx === -1) {
      return { url, status: null, state: "parse", stdout };
    }
    const body = stdout.slice(0, idx);
    const status = Number.parseInt(stdout.slice(idx + marker.length).trim(), 10);
    if (!Number.isFinite(status)) {
      return { url, status: null, state: "parse", stdout: body };
    }
    if (status === 404) return { url, status, state: "notfound", stdout: body };
    if (status === 200) {
      try {
        JSON.parse(body);
        return { url, status, state: "ok", stdout: body };
      } catch {
        return { url, status, state: "parse", stdout: body };
      }
    }
    return { url, status, state: "network", stdout: body };
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? "");
    const message = String((e as Error).message ?? "");
    const state = classifyPackumentError(message, stderr);
    return { url, status: state === "notfound" ? 404 : null, state, stdout: "" };
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

function asRead(
  source: IndependentSource,
  raw: Omit<RegistryRead, "source" | "exhausted404" | "attempts"> & { attempts?: number },
  attempt: number,
): Omit<RegistryRead, "exhausted404"> {
  return {
    source,
    url: raw.url,
    status: raw.status,
    state: raw.state,
    stdout: raw.stdout,
    attempts: raw.attempts ?? attempt,
  };
}

export function verifyPackagesOnRegistry(
  names: readonly string[],
  opts: RegistryVerifyOptions,
): { reports: PackageRegistryReport[]; overall: RegistryState } {
  const retries = opts.retries ?? DEFAULT_PACKUMENT_RETRIES;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_PACKUMENT_TIMEOUT_MS;
  const registry = opts.registry ?? CANONICAL_REGISTRY;
  const reports: PackageRegistryReport[] = [];
  for (const name of names) {
    const urls = {
      exact: exactVersionUrl(name, opts.version, registry),
      distTags: distTagsUrl(name, registry),
      root: packumentUrl(name, registry),
    };
    const reader =
      opts.readRegistry ??
      ((url: string) => defaultHttpGet(url, timeoutMs));
    const exact = probeRegistryWithRetries(
      (attempt) => asRead("exact", reader(urls.exact, attempt), attempt),
      retries,
    );
    const distTags = probeRegistryWithRetries(
      (attempt) => asRead("dist-tags", reader(urls.distTags, attempt), attempt),
      retries,
    );
    const root = probeRegistryWithRetries(
      (attempt) => asRead("root", reader(urls.root, attempt), attempt),
      retries,
    );

    const canonical = opts.canonicalSha256.get(name);
    let registrySha: string | undefined;
    let shaMatch: boolean | undefined;
    const tarball = tarballUrlFromExactOrRoot(opts.version, exact, root);
    if (tarball) {
      const dl = (opts.downloadTarball ?? ((url) => defaultDownloadTarball(url, timeoutMs)))(tarball);
      if (dl.bytes) {
        registrySha = sha256Buffer(dl.bytes);
        if (canonical) {
          shaMatch = registrySha === canonical;
        }
      }
    }

    const classified = classifyThreeSourceTruth({
      exact,
      distTags,
      root,
      version: opts.version,
      shaMatch,
    });
    const notes = [...classified.notes];
    if (shaMatch === false && canonical && registrySha) {
      notes.unshift(`registry sha256 ${registrySha} != canonical ${canonical}`);
    }
    reports.push({
      name,
      version: opts.version,
      state: classified.state,
      dist_tags: classified.dist_tags,
      registry_sha256: registrySha,
      canonical_sha256: canonical,
      notes,
      sources: {
        exact: { status: exact.status, state: exact.state },
        distTags: { status: distTags.status, state: distTags.state },
        root: { status: root.status, state: root.state },
      },
    });
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
