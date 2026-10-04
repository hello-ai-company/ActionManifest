import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { prepareMatoeManifest, prepareMatoeV02Manifest } from "./index.js";
import { validateActionManifest, type ActionManifest } from "@actionmanifest/core";

const read = (file: string) => readFileSync(new URL(`../fixtures/matoe-v02/${file}`, import.meta.url), "utf8");
const original = (): ActionManifest => JSON.parse(read("golden.json"));
const text = read("source.txt");
const sourceId = "11111111-1111-4111-8111-111111111111";

describe("explicit full-fidelity Matoe v0.2 wire", () => {
  it("keeps role/conditions/alternatives/ambiguity/all Evidence and provenance exactly", () => {
    const input = original();
    const before = structuredClone(input);
    const wire = prepareMatoeV02Manifest(input, text, sourceId);
    expect(validateActionManifest(wire).schema_version).toBe("0.2.0");
    expect(wire).toEqual(before);
    expect(input).toEqual(before);
    expect(wire).not.toBe(input);
    expect(wire.actions.some(action => action.actor.role === "guardian")).toBe(true);
    expect(wire.actions.some(action => action.conditions?.length)).toBe(true);
    expect(wire.actions.some(action => action.temporal?.alternatives?.length)).toBe(true);
    expect(wire.actions.some(action => action.temporal?.type === "approximate")).toBe(true);
    expect(wire.actions.some(action => action.evidence.length > 1)).toBe(true);
    expect(() => prepareMatoeManifest(input, text)).toThrow(/Matoe|Swift/);
  });

  it("retains a valid mixed receipt and the failed Action rather than filtering/promoting it", () => {
    const input = JSON.parse(read("mixed.json"));
    const wire = prepareMatoeV02Manifest(input, text, sourceId);
    expect(wire).toEqual(input);
    expect(wire.receipt?.verification?.passed).toBe(false);
    expect(wire.actions[0]?.status).toBe("proposed");
    expect(wire.receipt?.verification?.actions?.[0]?.passed).toBe(false);
    expect(wire.actions.slice(1).some(action => action.status === "verified")).toBe(true);
  });

  const negative: Array<[string, (input: ActionManifest) => void, RegExp]> = [
    ["unknown version", m => { m.schema_version = "0.3.0"; }, /frozen schema/],
    ["legacy version", m => { m.schema_version = "0.1.0"; }, /frozen schema/],
    ["unknown field", m => { Object.assign(m.actions[0]!, { arbitrary: "synthetic" }); }, /frozen schema/],
    ["explicit null", m => { Object.assign(m.source, { title: null }); }, /frozen schema/],
    ["hash mismatch", m => { m.source.hash = "0".repeat(64); }, /Source hash/],
    ["request identity mismatch", m => { m.source.id = "different"; }, /Source identity/],
    ["receipt version mismatch", m => { m.receipt!.extraction.schema_version = "0.1.0"; }, /provenance/],
    ["unknown provenance", m => { m.receipt!.extraction.model = "unknown"; }, /provenance/],
    ["missing provenance", m => { delete m.receipt; }, /provenance/],
    ["missing verification", m => { delete m.receipt!.verification; }, /verification/],
    ["duplicate action", m => { m.actions.push(structuredClone(m.actions[0]!)); }, /unique/],
    ["missing individual result", m => { m.receipt!.verification!.actions!.pop(); }, /complete and unique/],
    ["duplicate individual result", m => { m.receipt!.verification!.actions![1] = structuredClone(m.receipt!.verification!.actions![0]!); }, /complete and unique/],
    ["inconsistent summary", m => { m.receipt!.verification!.verified_actions = 0; }, /Aggregate verification/],
    ["contradictory passed flag", m => { m.receipt!.verification!.actions![0]!.temporal_supported = false; }, /verdict/],
    ["source fatal", m => { m.receipt!.verification!.source_hash_matched = false; }, /nonfatal/],
    ["invalid extraction time", m => { m.receipt!.extraction.created_at = "2026-10-03 00:00:00Z"; }, /provenance/],
    ["wrong Evidence source", m => { m.actions[0]!.evidence[0]!.source_id = "different"; }, /Evidence/],
    ["fabricated quote", m => { m.actions[0]!.evidence[0]!.text = "原文にない架空の根拠"; }, /Evidence/],
  ];
  it.each(negative)("refuses %s without mutating the input", (_name, change, reason) => {
    const input = original();
    change(input);
    const before = structuredClone(input);
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(reason);
    expect(input).toEqual(before);
  });

  it.each(["accepted", "rejected", "exported"] as const)("never resets %s lifecycle state", status => {
    const input = original();
    input.actions[0]!.status = status;
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/lifecycle/);
  });

  it("refuses a failed result marked verified", () => {
    const input = JSON.parse(read("mixed.json"));
    input.actions[0].status = "verified";
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/Failed verification/);
  });

  it.each(["negative-hash", "negative-version", "negative-approved", "negative-summary"])("refuses the shared %s fixture", name => {
    const input = JSON.parse(read(`${name}.json`));
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow();
  });

  it("preserves timezone/notes and rejects malformed Unicode instead of replacing it", () => {
    const input = original();
    input.actions[0]!.temporal!.timezone = "Asia/Tokyo";
    input.actions[0]!.notes = "合成注意事項 😀";
    expect(prepareMatoeV02Manifest(input, text, sourceId)).toEqual(input);
    input.actions[0]!.notes = "\ud800";
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/Unicode/);
  });

  it("rejects unmatched issue scopes and error issues marked passed", () => {
    const input = original();
    const flags = input.receipt!.verification!;
    const error = { code: "SYNTHETIC_ERROR", message: "合成エラー", action_id: input.actions[0]!.id };
    flags.actions![0]!.issues = [error];
    flags.issues = [error];
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/verdict/);
    flags.actions![0]!.issues = [{ ...error, action_id: input.actions[1]!.id }];
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/identify their Action/);
  });

  it("keeps new warnings as data and requires matching aggregates instead of discarding them", () => {
    const input = original();
    const flags = input.receipt!.verification!;
    const warning = { code: "SYNTHETIC_NEW_WARNING", message: "要確認の合成注意事項", severity: "warning" as const, action_id: input.actions[0]!.id };
    flags.issues = [warning];
    flags.actions![0]!.issues = [warning];
    flags.warning_actions = 1;
    expect(prepareMatoeV02Manifest(input, text, sourceId)).toEqual(input);
    flags.issues = [];
    expect(() => prepareMatoeV02Manifest(input, text, sourceId)).toThrow(/missing from the aggregate/);
  });
});
