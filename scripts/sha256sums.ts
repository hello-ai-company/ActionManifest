/**
 * SHA256SUMS helper — cwd-independent verification of release tarball hashes.
 *
 * The historical writer emitted *bare* filenames (`actionmanifest-cli-….tgz`)
 * while the files live under `tarballs/`. `sha256sum --check` from
 * `release-artifacts/` then looks in the wrong directory. This helper
 * resolves both layouts:
 *
 *   - `tarballs/<file>.tgz`  (preferred; `sha256sum --check` from the
 *     artifact root works)
 *   - bare `<file>.tgz`      (rc.0 / older artifacts — look in tarballs/)
 *
 * Never requires the process cwd to be a particular directory.
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";

export interface Sha256SumEntry {
  sha256: string;
  /** Path as written in SHA256SUMS (bare name or tarballs/…). */
  recorded: string;
  /** Absolute path that was hashed. */
  resolved: string;
}

export interface Sha256SumsVerifyResult {
  ok: boolean;
  sumsPath: string;
  artifactRoot: string;
  entries: Sha256SumEntry[];
  errors: string[];
}

const HASH_LINE = /^([a-f0-9]{64}) [ *](.+)$/;

/** Parse GNU `sha256sum` text. Ignores blank / comment lines. */
export function parseSha256Sums(text: string): { sha256: string; recorded: string }[] {
  const out: { sha256: string; recorded: string }[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const m = HASH_LINE.exec(line);
    if (!m) {
      throw new Error(`SHA256SUMS: unreadable line: ${JSON.stringify(raw)}`);
    }
    out.push({ sha256: m[1]!, recorded: m[2]!.trim() });
  }
  return out;
}

/**
 * Resolve a SHA256SUMS filename against an artifact root.
 * Accepts bare names, `tarballs/`-prefixed names, and absolute paths.
 */
export function resolveSumPath(artifactRoot: string, recorded: string): string {
  if (isAbsolute(recorded) && existsSync(recorded)) return recorded;
  const direct = join(artifactRoot, recorded);
  if (existsSync(direct)) return direct;
  const base = basename(recorded);
  const underTarballs = join(artifactRoot, "tarballs", base);
  if (existsSync(underTarballs)) return underTarballs;
  const sibling = join(artifactRoot, base);
  if (existsSync(sibling)) return sibling;
  throw new Error(
    `SHA256SUMS path ${JSON.stringify(recorded)} not found under ${artifactRoot} ` +
      `(tried ${recorded}, tarballs/${base}, and ${base})`,
  );
}

export function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Verify SHA256SUMS against files under `artifactRoot`.
 * `sumsPath` defaults to `<artifactRoot>/SHA256SUMS`.
 */
export function verifySha256Sums(
  artifactRoot: string,
  sumsPath = join(artifactRoot, "SHA256SUMS"),
): Sha256SumsVerifyResult {
  const errors: string[] = [];
  const entries: Sha256SumEntry[] = [];
  if (!existsSync(sumsPath)) {
    return {
      ok: false,
      sumsPath,
      artifactRoot,
      entries,
      errors: [`SHA256SUMS missing: ${sumsPath}`],
    };
  }
  let parsed: { sha256: string; recorded: string }[];
  try {
    parsed = parseSha256Sums(readFileSync(sumsPath, "utf8"));
  } catch (e) {
    return {
      ok: false,
      sumsPath,
      artifactRoot,
      entries,
      errors: [e instanceof Error ? e.message : String(e)],
    };
  }
  for (const row of parsed) {
    try {
      const resolved = resolveSumPath(artifactRoot, row.recorded);
      const actual = sha256File(resolved);
      if (actual !== row.sha256) {
        errors.push(`${row.recorded}: expected ${row.sha256}, got ${actual}`);
      }
      entries.push({ sha256: row.sha256, recorded: row.recorded, resolved });
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  return { ok: errors.length === 0, sumsPath, artifactRoot, entries, errors };
}

/**
 * Format SHA256SUMS using `tarballs/<basename>` so `sha256sum --check`
 * succeeds when run from the artifact root (the directory that contains
 * both SHA256SUMS and the tarballs/ directory).
 */
export function formatSha256Sums(entries: { sha256: string; file: string }[]): string {
  return (
    entries
      .map((e) => `${e.sha256}  tarballs/${basename(e.file)}`)
      .join("\n") + "\n"
  );
}

export function writeSha256Sums(
  artifactRoot: string,
  entries: { sha256: string; file: string }[],
): string {
  const path = join(artifactRoot, "SHA256SUMS");
  writeFileSync(path, formatSha256Sums(entries), "utf8");
  return path;
}

function looksLikeArtifactRoot(dir: string): boolean {
  return existsSync(join(dir, "SHA256SUMS")) || existsSync(join(dir, "release-manifest.json"));
}

/**
 * Locate the artifact root given a download directory that may nest
 * `release-artifacts/` or `release-check-<sha>/release-artifacts/`
 * (`gh run download` layout).
 */
export function locateArtifactRoot(downloadDir: string): string {
  const queue = [downloadDir];
  const seen = new Set<string>();
  while (queue.length > 0 && seen.size < 32) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    if (looksLikeArtifactRoot(current)) return current;
    let entries: { name: string; isDirectory: () => boolean }[] = [];
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      if (entry.name === "tarballs" || entry.name === "node_modules" || entry.name === ".git") {
        continue;
      }
      queue.push(join(current, entry.name));
    }
  }
  throw new Error(`cannot locate release artifact root under ${downloadDir}`);
}

function main(argv: string[]): void {
  const checkIdx = argv.indexOf("--check");
  const root = checkIdx >= 0 ? argv[checkIdx + 1] : argv[0];
  if (!root) {
    console.error("usage: sha256sums --check <artifact-root>");
    process.exit(2);
  }
  const result = verifySha256Sums(root);
  if (!result.ok) {
    console.error("SHA256SUMS FAIL:");
    for (const e of result.errors) console.error(`  ${e}`);
    process.exit(1);
  }
  console.log(`SHA256SUMS OK — ${result.entries.length} files (${result.artifactRoot})`);
}

const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main(process.argv.slice(2));
}
