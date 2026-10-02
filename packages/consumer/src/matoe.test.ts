import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCHEMA_VERSION, validateActionManifest, type ActionManifest } from "@actionmanifest/core";
import { prepareMatoeManifest } from "./matoe.js";
import { classifyManifest } from "./classify.js";

const fixture = (name: string): string => readFileSync(new URL(`../fixtures/matoe/${name}`, import.meta.url), "utf8");
const source = fixture("source.txt");
const original = (): ActionManifest => JSON.parse(fixture("verified-v02.json"));

describe("explicit Matoe compatibility contract", () => {
  it("matches the frozen golden wire, retains complete provenance, and preserves trust", () => {
    const input = original();
    const before = structuredClone(input);
    const bundle = prepareMatoeManifest(input, source);
    expect(bundle.manifest).toEqual(JSON.parse(fixture("expected-wire-v01.json")));
    expect(validateActionManifest(bundle.manifest).schema_version).toBe("0.1.0");
    expect(bundle.audit.originalManifest).toEqual(before);
    expect(bundle.audit.originalManifest.receipt?.extraction.schema_version).toBe("0.2.0");
    expect(bundle.audit.changes).toHaveLength(8);
    expect(input).toEqual(before);
    expect(classifyManifest(bundle.manifest).counts).toEqual(classifyManifest(input).counts);
    expect(SCHEMA_VERSION).toBe("0.2.0");
    bundle.manifest.actions[0].title = "changed";
    expect(bundle.audit.originalManifest).toEqual(before);
  });

  it("accepts already compatible v0.1 without changing provenance", () => {
    const wire = JSON.parse(fixture("expected-wire-v01.json"));
    const bundle = prepareMatoeManifest(wire, source);
    expect(bundle.manifest).toEqual(wire);
    expect(bundle.audit.changes).toEqual([]);
  });

  it("unverified extraction remains proposed and explicitly requires review", () => {
    const input = original();
    delete input.receipt!.verification;
    input.actions[0].status = "proposed";
    const bundle = prepareMatoeManifest(input, source);
    expect(bundle.manifest.actions[0].status).toBe("proposed");
    expect(bundle.manifest.receipt?.verification).toBeUndefined();
    expect(bundle.audit.warnings).toHaveLength(1);
    expect(classifyManifest(bundle.manifest).counts.ready).toBe(0);
  });

  it("preserves aggregate and per-action warning information", () => {
    const input = original();
    const issue = { code: "REVIEW", message: "Please review", action_id: "act_001", severity: "warning" as const };
    // Wire object key order is not part of issue identity.
    input.receipt!.verification!.issues = [{ severity: issue.severity, message: issue.message, code: issue.code, action_id: issue.action_id }];
    input.receipt!.verification!.actions![0].issues = [issue];
    input.receipt!.verification!.warning_actions = 1;
    const bundle = prepareMatoeManifest(input, source);
    expect(bundle.manifest.receipt?.verification?.issues).toEqual([issue]);
    expect(bundle.audit.originalManifest.receipt?.verification?.actions![0].issues).toEqual([issue]);
  });

  it("refuses a genuine mixed result without selecting only the successful action", () => {
    const input = original();
    const failed = structuredClone(input.actions[0]);
    failed.id = "act_002";
    failed.status = "proposed";
    input.actions.push(failed);
    const flags = input.receipt!.verification!;
    flags.actions!.push({ ...structuredClone(flags.actions![0]), action_id: "act_002", passed: false, actor_supported: false });
    Object.assign(flags, { passed: false, actor_supported: false, total_actions: 2, failed_actions: 1 });
    const before = structuredClone(input);
    expect(() => prepareMatoeManifest(input, source)).toThrow(/failed\/mixed/);
    expect(input).toEqual(before);
  });

  it("keeps every action in a unanimous multi-action receipt", () => {
    const input = original();
    input.actions.push({ ...structuredClone(input.actions[0]), id: "act_002" });
    const flags = input.receipt!.verification!;
    flags.actions!.push({ ...structuredClone(flags.actions![0]), action_id: "act_002" });
    Object.assign(flags, { total_actions: 2, verified_actions: 2 });
    const bundle = prepareMatoeManifest(input, source);
    expect(bundle.manifest.actions).toEqual(input.actions);
    expect(bundle.audit.originalManifest).toEqual(input);
    expect(classifyManifest(bundle.manifest).counts).toEqual(classifyManifest(input).counts);
  });

  const negative: [string, (manifest: ActionManifest) => void, RegExp][] = [
    ["unknown version", m => { m.schema_version = "0.3.0"; }, /Unsupported/],
    ["prototype version", m => { m.schema_version = "constructor"; }, /Unsupported/],
    ["unknown root field", m => { Object.assign(m, { future: true }); }, /schema/],
    ["unknown nested field", m => { Object.assign(m.actions[0].actor, { future: true }); }, /schema/],
    ["explicit null", m => { Object.assign(m.source, { title: null }); }, /schema/],
    ["missing hash", m => { delete m.source.hash; }, /SHA-256/],
    ["wrong hash", m => { m.source.hash = "0".repeat(64); }, /SHA-256/],
    ["missing receipt", m => { delete m.receipt; }, /provenance/],
    ["provenance version mismatch", m => { m.receipt!.extraction.schema_version = "0.1.0"; }, /provenance/],
    ["unknown provenance version", m => { m.receipt!.extraction.schema_version = "0.3.0"; }, /provenance/],
    ["unknown provider", m => { m.receipt!.extraction.provider = "unknown"; }, /provenance/],
    ["blank model", m => { m.receipt!.extraction.model = " "; }, /provenance/],
    ["invalid receipt date", m => { m.receipt!.extraction.created_at = "tomorrow"; }, /schema/],
    ["duplicate IDs", m => { m.actions.push(structuredClone(m.actions[0])); }, /Duplicate/],
    ["wrong evidence source", m => { m.actions[0].evidence[0].source_id = "other"; }, /evidence/],
    ["unsupported evidence", m => { m.actions[0].evidence[0].text = "Invented"; }, /evidence/],
    ["empty evidence", m => { m.actions[0].evidence = []; }, /schema/],
    ["verified without receipt", m => { delete m.receipt!.verification; }, /without verification/],
    ["fatal hash receipt", m => { m.receipt!.verification!.source_hash_matched = false; }, /clean verification/],
    ["negation", m => { m.receipt!.verification!.negation_conflict = true; }, /clean verification/],
    ["soft verification failure", m => { m.receipt!.verification!.actor_supported = false; }, /clean verification/],
    ["missing per-action results", m => { delete m.receipt!.verification!.actions; }, /per-action/],
    ["wrong per-action ID", m => { m.receipt!.verification!.actions![0].action_id = "other"; }, /per-action/],
    ["per-action passed contradicts checks", m => { m.receipt!.verification!.actions![0].actor_supported = false; }, /per-action/],
    ["mixed per-action failure", m => { m.receipt!.verification!.actions![0].passed = false; }, /per-action/],
    ["inconsistent total", m => { m.receipt!.verification!.total_actions = 2; }, /summary/],
    ["inconsistent passed", m => { m.receipt!.verification!.passed = false; }, /summary/],
    ["missing count", m => { delete m.receipt!.verification!.warning_actions; }, /summary/],
    ["unspecified severity", m => { m.receipt!.verification!.issues = [{ code: "ERR", message: "Error" }]; }, /clean verification/],
    ["blank issue", m => { m.receipt!.verification!.issues = [{ code: " ", message: "Warning", severity: "warning" }]; }, /issue/],
    ["hidden per-action warning", m => {
      m.receipt!.verification!.actions![0].issues = [{ code: "WARN", message: "Warning", severity: "warning" }];
      m.receipt!.verification!.warning_actions = 1;
    }, /projection would hide/],
    ["rich temporal outside profile", m => { m.actions[0].temporal!.alternatives = [{ type: "conditional", raw_text: "if rain" }]; }, /temporal form/],
    ["contradictory temporal year", m => { m.actions[0].temporal!.year = 2027; }, /contradict/],
    ["postmark deadline", m => { m.actions[0].temporal!.deadline_qualifier = "postmark_valid"; }, /temporal form/],
  ];
  it.each(negative)("refuses %s with a reason and leaves input untouched", (_name, mutate, reason) => {
    const input = original();
    mutate(input);
    const before = structuredClone(input);
    expect(() => prepareMatoeManifest(input, source)).toThrow(reason);
    expect(input).toEqual(before);
  });

  it.each(["accepted", "exported", "rejected"] as const)("never resets %s lifecycle state", status => {
    const input = original();
    input.actions[0].status = status;
    expect(() => prepareMatoeManifest(input, source)).toThrow(/approval\/lifecycle/);
  });

  it("requires the exact OCR bytes and does not trim or normalize", () => {
    expect(() => prepareMatoeManifest(original(), source.trim())).toThrow(/SHA-256/);
    expect(() => prepareMatoeManifest(original(), "")).toThrow(/empty/);
  });
});
