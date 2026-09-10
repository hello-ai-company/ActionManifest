import { describe, expect, it } from "vitest";
import { findForbiddenPatterns } from "./docs-check.js";

/**
 * The forbidden/safe forms are built by concatenation so this test file
 * never contains a literal scannable invocation (scripts/docs-check* are
 * exempt from the repo scan regardless).
 */
const NPX = "np" + "x";
const BIN = "action" + "man";
const PKG = "--package=@actionmanifest/cli";
const BOOT = "pnpm bootstrap:" + "check";
const PUB = "npm pub" + "lish";
const REG = "--registry https://registry.npmjs.org/";

describe("docs:check no-bare-npx-actionman", () => {
  it("flags the bare one-shot form", () => {
    const v = findForbiddenPatterns(`${NPX} ${BIN} conformance\n`, "README.md");
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(1);
    expect(v[0]!.rule).toBe("no-bare-npx-actionman");
  });

  it("flags flag-prefix variants like -y / --yes", () => {
    expect(findForbiddenPatterns(`${NPX} -y ${BIN} --version\n`, "a.md")).toHaveLength(1);
    expect(findForbiddenPatterns(`${NPX} --yes ${BIN}\n`, "a.md")).toHaveLength(1);
  });

  // Regression tests (ChatGPT re-review): a trailing --package is an argument
  // to the executed binary, NOT an npx option — these MUST fail.
  it("FAILS when --package trails the bare positional (npx actionman --package=…)", () => {
    const v = findForbiddenPatterns(`${NPX} ${BIN} ${PKG} conformance\n`, "a.md");
    expect(v).toHaveLength(1);
  });

  it("FAILS when -y precedes the bare positional and --package trails (npx -y actionman --package=…)", () => {
    const v = findForbiddenPatterns(`${NPX} -y ${BIN} ${PKG} --version\n`, "a.md");
    expect(v).toHaveLength(1);
  });

  it("FAILS the double-dash form without --package (npx -- actionman)", () => {
    const v = findForbiddenPatterns(`${NPX} -- ${BIN} conformance\n`, "a.md");
    expect(v).toHaveLength(1);
  });

  it("PASSES the safe one-shot form (package option before --)", () => {
    const safe = `${NPX} ${PKG} -- ${BIN} conformance\n`;
    expect(findForbiddenPatterns(safe, "a.md")).toHaveLength(0);
  });

  it("PASSES the safe form with npx flags before --package", () => {
    const safe = `${NPX} -y ${PKG} -- ${BIN} --version\n`;
    expect(findForbiddenPatterns(safe, "a.md")).toHaveLength(0);
  });

  it("PASSES the space-separated --package value form", () => {
    const safe = `${NPX} --package @actionmanifest/cli -- ${BIN} conformance\n`;
    expect(findForbiddenPatterns(safe, "a.md")).toHaveLength(0);
  });

  it("accepts the installed-bin form", () => {
    expect(findForbiddenPatterns(`${BIN} conformance\n${BIN} --help\n`, "a.md")).toHaveLength(0);
  });

  it("accepts unrelated npx usage and prose", () => {
    const prose = [
      `${NPX} tsx scripts/release-dry-run.ts`,
      `use ${NPX} with --package to name the package explicitly`,
      "the unscoped npm name `actionman` belongs to an unrelated project",
      `${NPX} --package=@actionmanifest/cli -- node --version`,
    ].join("\n");
    expect(findForbiddenPatterns(prose, "a.md")).toHaveLength(0);
  });

  it("reports every offending line with correct line numbers", () => {
    const content = `ok line\n${NPX} ${BIN} one\nfine\n${NPX} -y ${BIN} two\n`;
    const v = findForbiddenPatterns(content, "b.md");
    expect(v.map((x) => x.line)).toEqual([2, 4]);
  });

  it("stops analysis at shell command terminators", () => {
    // The second command is a separate, safe installed-bin invocation.
    const line = `${NPX} ${PKG} -- ${BIN} conformance && ${BIN} --version\n`;
    expect(findForbiddenPatterns(line, "a.md")).toHaveLength(0);
  });
});

describe("docs:check bootstrap-publish-safety", () => {
  it("flags a mode-less bootstrap:check (the permissive default must not be documented)", () => {
    const v = findForbiddenPatterns(`${BOOT}   # regenerate the plan\n`, "docs/x.md");
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("bootstrap-publish-safety");
  });

  it("accepts --prepare and --publish-ready modes", () => {
    expect(findForbiddenPatterns(`${BOOT} --prepare\n`, "a.md")).toHaveLength(0);
    expect(findForbiddenPatterns(`${BOOT} --publish-ready\n`, "a.md")).toHaveLength(0);
  });

  it("flags a publish command line without the registry pin", () => {
    const v = findForbiddenPatterns(
      `${PUB} ./release-artifacts/tarballs/x.tgz --access public --tag next\n`,
      "docs/x.md",
    );
    expect(v).toHaveLength(1);
    expect(v[0]!.rule).toBe("bootstrap-publish-safety");
  });

  it("accepts a publish command line with the registry pin", () => {
    const v = findForbiddenPatterns(
      `${PUB} ./release-artifacts/tarballs/x.tgz --access public --tag next ${REG}\n`,
      "docs/x.md",
    );
    expect(v).toHaveLength(0);
  });

  it("judges multi-line commands (trailing backslash) as one logical line", () => {
    const good = `${PUB} ./x.tgz \\\n  --access public \\\n  --tag next \\\n  ${REG}\n`;
    expect(findForbiddenPatterns(good, "docs/x.md")).toHaveLength(0);
    const bad = `${PUB} ./x.tgz \\\n  --access public \\\n  --tag next\n`;
    const v = findForbiddenPatterns(bad, "docs/x.md");
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(1);
  });

  it("does not flag prose mentions of publishing (not command lines)", () => {
    const prose = `The step never runs \`${PUB}\` itself; see the runbook.\n`;
    expect(findForbiddenPatterns(prose, "a.md")).toHaveLength(0);
  });
});
