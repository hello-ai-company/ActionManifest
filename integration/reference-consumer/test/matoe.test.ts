import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { ActionExtractor, DeterministicProvider } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { prepareMatoeManifest, classifyManifest } from "@actionmanifest/consumer";
import { validateActionManifest } from "@actionmanifest/core";

const root = resolve(import.meta.dirname, "../../..");
const fixtures = join(root, "packages/consumer/fixtures/matoe");

describe("built-package Matoe compatibility", () => {
  it("adapts, extracts, verifies and projects while preserving all original actions and receipt", async () => {
    const text = readFileSync(join(fixtures, "plain-source.txt"), "utf8");
    const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "matoe-notice", text });
    const candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
    expect(candidate.schema_version).toBe("0.2.0");
    const { manifest, flags } = verifyManifest(candidate, doc);
    expect(flags.passed).toBe(true);
    expect(manifest.actions.length).toBeGreaterThan(0);
    const bundle = prepareMatoeManifest(manifest, text);
    expect(validateActionManifest(bundle.manifest).schema_version).toBe("0.1.0");
    expect(bundle.manifest.actions).toEqual(manifest.actions);
    expect(bundle.audit.originalManifest).toEqual(manifest);
    expect(classifyManifest(bundle.manifest).counts).toEqual(classifyManifest(manifest).counts);
  });

  it("refuses actual extractor output carrying an actor role the Swift domain would discard", async () => {
    const text = readFileSync(join(fixtures, "source.txt"), "utf8");
    const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "matoe-notice", text });
    const candidate = await new ActionExtractor(new DeterministicProvider(doc)).extract(doc);
    const { manifest, flags } = verifyManifest(candidate, doc);
    expect(flags.passed).toBe(true);
    expect(manifest.actions[0]?.actor.role).toBe("guardian");
    expect(() => prepareMatoeManifest(manifest, text)).toThrow(/role is unsupported/);
  });

  it("built CLI emits complete golden bundle and refuses destructive output reuse", () => {
    const cli = join(root, "apps/cli/dist/index.js");
    const args = [cli, "prepare-matoe", join(fixtures, "verified-v02.json"), "--doc", join(fixtures, "source.txt")];
    const output = JSON.parse(execFileSync(process.execPath, [...args, "--json"], { cwd: root, encoding: "utf8" }));
    expect(output.manifest).toEqual(JSON.parse(readFileSync(join(fixtures, "expected-wire-v01.json"), "utf8")));
    expect(output.audit.originalManifest.schema_version).toBe("0.2.0");
    const dir = mkdtempSync(join(tmpdir(), "matoe-cli-"));
    try {
      const path = join(dir, "bundle.json");
      execFileSync(process.execPath, [...args, "--out", path]);
      expect(() => execFileSync(process.execPath, [...args, "--out", path], { stdio: "pipe" })).toThrow();
      expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(output);
      if (process.platform !== "win32") expect(statSync(path).mode & 0o777).toBe(0o600);
      try {
        execFileSync(process.execPath, [cli, "prepare-matoe", join(fixtures, "verified-v02.json"), "--doc", join(fixtures, "verified-v02.json"), "--json"], { stdio: "pipe" });
        expect.fail("must reject a different source");
      } catch (error) {
        expect(String((error as { stderr: Buffer }).stderr)).toContain("MATOE_COMPATIBILITY_BLOCKED");
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not implicitly print the original manifest or echo malformed/private input in diagnostics", () => {
    const cli = join(root, "apps/cli/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "matoe-private-"));
    const marker = "SYNTHETIC_PRIVATE_FIELD_DO_NOT_LOG";
    const input = join(dir, "input.json");
    const doc = join(fixtures, "source.txt");
    try {
      writeFileSync(input, marker);
      let run = spawnSync(process.execPath, [cli, "prepare-matoe", input, "--doc", doc], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("MATOE_OUTPUT_REQUIRED");
      run = spawnSync(process.execPath, [cli, "prepare-matoe", input, "--doc", doc, "--json"], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).not.toContain(marker);
      writeFileSync(input, JSON.stringify({ schema_version: marker, actions: [], source: { id: marker } }));
      run = spawnSync(process.execPath, [cli, "prepare-matoe", input, "--doc", doc, "--json"], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("SCHEMA_VALIDATION");
      expect(run.stderr).not.toContain(marker);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds file reads and rejects malformed UTF-8 before emitting a bundle", () => {
    const cli = join(root, "apps/cli/dist/index.js");
    const dir = mkdtempSync(join(tmpdir(), "matoe-limits-"));
    const input = join(dir, "large.json");
    const source = join(dir, "invalid.txt");
    try {
      writeFileSync(input, " ".repeat(1_048_577));
      let run = spawnSync(process.execPath, [cli, "prepare-matoe", input, "--doc", join(fixtures, "source.txt"), "--json"], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("size limit");
      writeFileSync(source, Buffer.from([0xc3, 0x28]));
      run = spawnSync(process.execPath, [cli, "prepare-matoe", join(fixtures, "verified-v02.json"), "--doc", source, "--json"], { encoding: "utf8" });
      expect(run.status).toBe(1);
      expect(run.stdout).toBe("");
      expect(run.stderr).toContain("input details omitted");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
