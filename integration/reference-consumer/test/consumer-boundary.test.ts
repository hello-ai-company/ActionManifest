import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateActionManifest } from "@actionmanifest/core";
import { verifyManifest } from "@actionmanifest/verifier";
import { classifyManifest, prepareMatoeManifest } from "@actionmanifest/consumer";

const fixtures = resolve(import.meta.dirname, "../../../packages/consumer/fixtures/matoe");
const read = (name: string) => readFileSync(join(fixtures, name), "utf8");

describe("generic public APIs remain independent of the Matoe presentation profile", () => {
  it.each([
    ["guardian", "source.txt", /role is unsupported/],
    ["timezone", "source.txt", /timezone/],
    ["conditions", "source.txt", /conditions\/notes/],
    ["notes", "source.txt", /conditions\/notes/],
    ["multiple-evidence", "source.txt", /distinct quotes\/locators/],
    ["rain-alternative", "temporal-source.txt", /temporal form/],
    ["approximate-date", "temporal-source.txt", /temporal form/],
  ])("verifies and retains %s for other consumers while explicitly refusing Matoe", (name, source, reason) => {
    const input = JSON.parse(read(`design-handoff/${name}.json`));
    // Exercise the default v0.2 API, not only a legacy/native v0.1 fixture.
    input.schema_version = "0.2.0";
    input.receipt.extraction.schema_version = "0.2.0";
    const candidate = validateActionManifest(input);
    const text = read(`design-handoff/${source}`);
    const before = structuredClone(candidate);
    const { manifest, flags } = verifyManifest(candidate, { id: candidate.source.id, text, sourceHash: candidate.source.hash });
    expect(flags.passed).toBe(true);
    expect(validateActionManifest(manifest).schema_version).toBe("0.2.0");
    expect(candidate).toEqual(before);
    expect(manifest.actions).toEqual(before.actions.map(action => ({ ...action, status: "verified" })));
    const report = classifyManifest(manifest);
    expect(report.counts).toEqual({ ready: 1, review_required: 0, blocked: 0 });
    expect(report.actions[0]?.action).toEqual(manifest.actions[0]);
    const verified = structuredClone(manifest);
    expect(() => prepareMatoeManifest(manifest, text)).toThrow(reason);
    expect(manifest).toEqual(verified);
    expect(classifyManifest(manifest)).toEqual(report);
  });

  it("surfaces a passing warning in the generic consumer without hiding it for Matoe", () => {
    const input = JSON.parse(read("verified-v02.json"));
    const warning = { code: "APP_REVIEW_NOTE", message: "Synthetic review note", severity: "warning", action_id: input.actions[0].id };
    input.receipt.verification.issues = [warning];
    input.receipt.verification.actions[0].issues = [warning];
    input.receipt.verification.warning_actions = 1;
    const manifest = validateActionManifest(input);
    const before = structuredClone(manifest);
    const report = classifyManifest(manifest);
    expect(report.actions[0]?.disposition).toBe("ready");
    expect(report.actions[0]?.reasons).toContainEqual({ code: warning.code, message: warning.message });
    expect(() => prepareMatoeManifest(manifest, read("source.txt"))).toThrow(/issues\/warnings/);
    expect(manifest).toEqual(before);
  });
});
