import { describe, expect, it } from "vitest";
import { findForbiddenPatterns } from "./docs-check.js";

/**
 * The forbidden form is built by concatenation so this test file never
 * contains the literal pattern (the repo scan would flag it otherwise;
 * scripts/docs-check* are exempt from the scan regardless).
 */
const BARE = "np" + "x actionman";

describe("docs:check no-bare-npx-actionman", () => {
  it("flags the bare one-shot form", () => {
    const v = findForbiddenPatterns(`${BARE} conformance\n`, "README.md");
    expect(v).toHaveLength(1);
    expect(v[0]!.line).toBe(1);
    expect(v[0]!.rule).toBe("no-bare-npx-actionman");
  });

  it("flags flag variants like -y / --yes", () => {
    expect(findForbiddenPatterns(`np` + `x -y actionman --version\n`, "a.md")).toHaveLength(1);
    expect(findForbiddenPatterns(`np` + `x --yes actionman\n`, "a.md")).toHaveLength(1);
  });

  it("accepts the installed-bin form", () => {
    expect(findForbiddenPatterns("actionman conformance\nactionman --help\n", "a.md")).toHaveLength(0);
  });

  it("accepts the explicit --package one-shot form", () => {
    const safe = "np" + "x --package=@actionmanifest/cli -- actionman conformance\n";
    expect(findForbiddenPatterns(safe, "a.md")).toHaveLength(0);
  });

  it("accepts unrelated npx usage and prose", () => {
    const prose = [
      "npx tsx scripts/release-dry-run.ts",
      "use npx with --package to name the package explicitly",
      "the unscoped npm name `actionman` belongs to an unrelated project",
    ].join("\n");
    expect(findForbiddenPatterns(prose, "a.md")).toHaveLength(0);
  });

  it("reports every offending line with correct line numbers", () => {
    const content = `ok line\n${BARE} one\nfine\n${BARE} two\n`;
    const v = findForbiddenPatterns(content, "b.md");
    expect(v.map((x) => x.line)).toEqual([2, 4]);
  });
});
