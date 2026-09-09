/**
 * docs:check — forbidden-pattern gate for docs, READMEs, scripts, workflows,
 * and evidence notes (President+ChatGPT review, Phase 2.3 blocker 1).
 *
 * Rule `no-bare-npx-actionman`: the bare form "npx" immediately followed by
 * an `actionman` positional is FORBIDDEN. Without `--package`, npx treats the
 * first positional as the package specifier — and the unscoped npm name
 * `actionman` is an unrelated package, so the bare form can fetch and run the
 * WRONG code. Safe forms:
 *
 *   actionman …                                          (installed bin)
 *   npx --package=@actionmanifest/cli -- actionman …     (one-shot)
 *
 * This file (and its test) are exempt from the scan — the pattern has to be
 * defined somewhere.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export interface DocsCheckViolation {
  file: string;
  line: number;
  text: string;
  rule: string;
}

const SAFE_PACKAGE_FLAG = "--package=@actionmanifest/cli";
// npx + optional simple flags + a bare actionman positional token.
const NPX_BARE_ACTIONMAN = /\bnpx\s+(?:-{1,2}[\w-]+(?:=\S+)?\s+)*actionman\b/;

/** Exported for tests: scan one file's content, return violations. */
export function findForbiddenPatterns(content: string, file: string): DocsCheckViolation[] {
  const violations: DocsCheckViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (NPX_BARE_ACTIONMAN.test(line) && !line.includes(SAFE_PACKAGE_FLAG)) {
      violations.push({
        file,
        line: i + 1,
        text: line.trim(),
        rule: "no-bare-npx-actionman",
      });
    }
  }
  return violations;
}

const SCAN_EXTENSIONS = new Set([".md", ".ts", ".mts", ".mjs", ".yml", ".yaml", ".txt"]);
const SKIP_DIRS = new Set(["node_modules", "dist", ".git", "release-artifacts", "coverage", ".turbo", ".cache"]);
// The gate's own implementation is exempt (the pattern is defined there).
const SKIP_FILES = new Set(["scripts/docs-check.ts", "scripts/docs-check.test.ts"]);

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(path);
    } else if (entry.isFile()) {
      yield path;
    }
  }
}

function main(): void {
  const violations: DocsCheckViolation[] = [];
  for (const file of walk(root)) {
    const rel = relative(root, file);
    if (SKIP_FILES.has(rel)) continue;
    const ext = file.slice(file.lastIndexOf("."));
    if (!SCAN_EXTENSIONS.has(ext)) continue;
    if (!statSync(file).isFile()) continue;
    violations.push(...findForbiddenPatterns(readFileSync(file, "utf8"), rel));
  }
  if (violations.length > 0) {
    console.error("docs:check FAIL — forbidden patterns found:");
    for (const v of violations) {
      console.error(`  ${v.file}:${v.line} [${v.rule}] ${v.text}`);
    }
    console.error(
      'Use the installed bin ("actionman …") or the explicit one-shot form with ' +
        `${SAFE_PACKAGE_FLAG}.`,
    );
    process.exit(1);
  }
  console.log("docs:check PASS (no forbidden npx/bin package-identity patterns)");
}

const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main();
}
