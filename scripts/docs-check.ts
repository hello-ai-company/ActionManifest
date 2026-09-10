/**
 * docs:check — forbidden-pattern gate for docs, READMEs, scripts, workflows,
 * and evidence notes (President+ChatGPT review, Phase 2.3 blocker 1).
 *
 * Rule `no-bare-npx-actionman`: an npx invocation whose first positional
 * (the package/command specifier) is `actionman` is FORBIDDEN. Per npm, npx
 * options must appear BEFORE the first positional — a trailing `--package`
 * is an argument to the executed binary, so forms like
 *
 *   npx actionman --package=@actionmanifest/cli conformance   (UNSAFE)
 *   npx -y actionman --package=@actionmanifest/cli …          (UNSAFE)
 *
 * still resolve the bare `actionman` package (an unrelated npm package).
 * The only safe one-shot form puts the package option before `--`:
 *
 *   npx --package=@actionmanifest/cli -- actionman …          (SAFE)
 *   npx -y --package=@actionmanifest/cli -- actionman …       (SAFE)
 *
 * and the installed bin needs no npx at all:
 *
 *   actionman …                                               (SAFE)
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

const CLI_PACKAGE = "@actionmanifest/cli";
const SAFE_PACKAGE_FLAG = `--package=${CLI_PACKAGE}`;
/** Shell tokens that terminate a command invocation in docs prose/code. */
const COMMAND_TERMINATORS = new Set(["&&", "||", ";", "|", "|&", ")", "`"]);

interface NpxInvocationAnalysis {
  /** First positional token after npx options (the package/command specifier). */
  firstPositional?: string;
  /** Command token following a `--` separator, if any. */
  commandAfterSeparator?: string;
  /** Values collected from --package/-p options that appear BEFORE the first positional or `--`. */
  packageOptions: string[];
}

/**
 * Parse the tokens following an `npx` token. npx options are only options
 * when they appear before the first positional or the `--` separator —
 * anything after the first positional belongs to the executed command.
 */
function analyzeNpxArgs(args: string[]): NpxInvocationAnalysis {
  const packageOptions: string[] = [];
  let firstPositional: string | undefined;
  let commandAfterSeparator: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const tok = args[i]!;
    if (COMMAND_TERMINATORS.has(tok)) break;
    if (tok === "--") {
      commandAfterSeparator = args[i + 1];
      break;
    }
    if (firstPositional === undefined) {
      if (tok === "--package" || tok === "-p") {
        const value = args[i + 1];
        if (value !== undefined && !COMMAND_TERMINATORS.has(value)) {
          packageOptions.push(value);
          i++;
        }
        continue;
      }
      if (tok.startsWith("--package=")) {
        packageOptions.push(tok.slice("--package=".length));
        continue;
      }
      if (tok.startsWith("-p=")) {
        packageOptions.push(tok.slice(3));
        continue;
      }
      if (tok.startsWith("-")) continue; // other npx option (e.g. -y, --yes, --no-install)
      firstPositional = tok;
      break;
    }
  }
  const out: NpxInvocationAnalysis = { packageOptions };
  if (firstPositional !== undefined) out.firstPositional = firstPositional;
  if (commandAfterSeparator !== undefined) out.commandAfterSeparator = commandAfterSeparator;
  return out;
}

/** Strip matching surrounding quotes/backticks from a token. */
function unquote(token: string): string {
  return token.replace(/^["'`]+/, "").replace(/["'`,.;:]+$/, "");
}

/**
 * Exported for tests: scan one file's content, return violations.
 * A line may contain prose plus code; every `npx` token is analyzed.
 */
export function findForbiddenPatterns(content: string, file: string): DocsCheckViolation[] {
  const violations: DocsCheckViolation[] = [];
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const tokens = line.split(/\s+/).filter(Boolean);
    for (let t = 0; t < tokens.length; t++) {
      if (unquote(tokens[t]!) !== "npx") continue;
      const analysis = analyzeNpxArgs(tokens.slice(t + 1).map(unquote));
      const touchesActionman =
        analysis.firstPositional === "actionman" ||
        analysis.commandAfterSeparator === "actionman";
      if (!touchesActionman) continue;
      const safe =
        analysis.firstPositional === undefined && // command comes after `--`
        analysis.commandAfterSeparator === "actionman" &&
        analysis.packageOptions.includes(CLI_PACKAGE);
      if (!safe) {
        violations.push({
          file,
          line: i + 1,
          text: line.trim(),
          rule: "no-bare-npx-actionman",
        });
      }
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
        `${SAFE_PACKAGE_FLAG} BEFORE the "--" separator.`,
    );
    process.exit(1);
  }
  console.log("docs:check PASS (no forbidden npx/bin package-identity patterns)");
}

const invokedAs = process.argv[1];
if (invokedAs && import.meta.url === new URL(`file://${invokedAs}`).href) {
  main();
}
