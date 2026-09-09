import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ActionManifestError,
  checkCanonicalDocument,
  evaluateActionTrust,
  trustDispositionFor,
  validateActionManifest,
  validateCanonicalDocument,
  type Action,
  type ActionManifest,
  type VerificationFlags,
} from "@actionmanifest/core";
import { verifyManifest } from "@actionmanifest/verifier";
import { exportIcs, selectExportableActions } from "@actionmanifest/exporters";

/**
 * ActionManifest Conformance Runner (Phase 2.1).
 *
 * Executes the language-neutral test vectors under conformance/vectors using
 * ONLY public package APIs — the same surface a third-party implementation
 * would consume. The vectors are normative (hand-written from the spec); the
 * reference implementation is never the oracle. See docs/CONFORMANCE.md.
 */

export const CONFORMANCE_SUITE_NAME = "actionmanifest-conformance";

export interface SuiteManifest {
  suite: string;
  suite_version: string;
  schema_versions: string[];
  profiles: string[];
  smoke_profiles: string[];
}

interface Vector {
  id: string;
  profile: string;
  description?: string;
  input: Record<string, unknown>;
  expected: Record<string, unknown>;
}

export interface VectorResult {
  id: string;
  profile: string;
  passed: boolean;
  /** True when this vector guards against exporting an untrusted Action. */
  critical: boolean;
  detail?: string;
}

export interface ConformanceReport {
  suite_version: string;
  result: "conformant" | "non-conformant";
  profiles: Record<string, { passed: number; total: number }>;
  totals: { passed: number; total: number };
  critical_false_exported: number;
  failures: { id: string; profile: string; detail: string }[];
}

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");

export async function defaultConformanceRoot(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    join(process.cwd(), "conformance"),
    join(here, "../../../conformance"),
    join(here, "../../../../conformance"),
  ];
  for (const c of candidates) {
    try {
      await readdir(c);
      return c;
    } catch {
      /* try next */
    }
  }
  return join(process.cwd(), "conformance");
}

async function loadVectors(root: string): Promise<Vector[]> {
  const vectorsDir = join(root, "vectors");
  const vectors: Vector[] = [];
  for (const profile of await readdir(vectorsDir, { withFileTypes: true })) {
    if (!profile.isDirectory()) continue;
    const dir = join(vectorsDir, profile.name);
    for (const file of (await readdir(dir)).sort()) {
      if (!file.endsWith(".json")) continue;
      const parsed = JSON.parse(await readFile(join(dir, file), "utf8")) as Vector;
      vectors.push(parsed);
    }
  }
  vectors.sort((a, b) => a.id.localeCompare(b.id));
  return vectors;
}

// ---------- shared fixture builders (spec-derived, not implementation output) ----------

function passedPerAction(id: string): Record<string, unknown> {
  return {
    action_id: id,
    passed: true,
    evidence_supported: true,
    temporal_supported: true,
    actor_supported: true,
    modality_supported: true,
    negation_conflict: false,
    page_refs_valid: true,
    issues: [],
  };
}

/** Build a schema-valid manifest wrapping one action + verification flags. */
function manifestFor(action: Action, verification?: VerificationFlags): ActionManifest {
  return {
    schema_version: "0.2.0",
    source: { id: action.evidence[0]?.source_id ?? "conf" },
    actions: [action],
    receipt: {
      extraction: {
        provider: "conformance",
        model: "none",
        extractor_version: "0",
        schema_version: "0.2.0",
        created_at: "2026-01-01T00:00:00.000Z",
      },
      ...(verification ? { verification } : {}),
    },
  };
}

// ---------- profile runners ----------

function runSchema(v: Vector): string | undefined {
  let valid = true;
  let code: string | undefined;
  try {
    validateActionManifest(v.input);
  } catch (e) {
    valid = false;
    code = e instanceof ActionManifestError ? e.code : "UNKNOWN";
  }
  const exp = v.expected as { valid: boolean; error_code?: string };
  if (valid !== exp.valid) return `expected valid=${exp.valid}, got valid=${valid}`;
  if (exp.error_code && code !== exp.error_code) {
    return `expected error_code=${exp.error_code}, got ${code}`;
  }
  return undefined;
}

function runCanonicalDocument(v: Vector): string | undefined {
  const exp = v.expected as { valid: boolean; errors?: string[]; warnings?: string[] };
  let schemaValid = true;
  try {
    validateCanonicalDocument(v.input);
  } catch {
    schemaValid = false;
  }
  if (!schemaValid) {
    return exp.valid === false ? undefined : "schema-invalid document, expected valid";
  }
  const issues = checkCanonicalDocument(v.input as never);
  const errors = issues.filter((i) => i.severity === "error").map((i) => i.code);
  const warnings = issues.filter((i) => i.severity === "warning").map((i) => i.code);
  const expectErrors = exp.errors ?? [];
  const expectWarnings = exp.warnings ?? [];
  const valid = errors.length === 0;
  if (valid !== exp.valid) return `expected valid=${exp.valid}, got errors=${errors.join(",")}`;
  if (expectErrors.sort().join() !== [...errors].sort().join()) {
    return `expected errors [${expectErrors}], got [${errors}]`;
  }
  if (expectWarnings.sort().join() !== [...warnings].sort().join()) {
    return `expected warnings [${expectWarnings}], got [${warnings}]`;
  }
  return undefined;
}

function runEvidence(v: Vector): string | undefined {
  const input = v.input as { manifest: unknown; document: unknown };
  const doc = validateCanonicalDocument(input.document);
  const { flags } = verifyManifest(input.manifest, doc);
  const expActions = (v.expected as { actions: Record<string, Record<string, boolean>> }).actions;
  for (const [actionId, checks] of Object.entries(expActions)) {
    const result = (flags.actions ?? []).find((r) => r.action_id === actionId);
    if (!result) return `no per-action result for ${actionId}`;
    for (const [key, value] of Object.entries(checks)) {
      const actual = (result as unknown as Record<string, boolean>)[key];
      if (actual !== value) return `${actionId}.${key}: expected ${value}, got ${actual}`;
    }
  }
  return undefined;
}

function runTrust(v: Vector): { detail?: string; criticalFalseExported: boolean } {
  const input = v.input as { action: Action; verification?: VerificationFlags | null };
  const exp = v.expected as {
    ready: boolean;
    reason: string;
    disposition: string;
    exportable_default: boolean;
  };
  const flags = input.verification ?? undefined;
  const trust = evaluateActionTrust(input.action, flags);
  if (trust.ready !== exp.ready) {
    return { detail: `ready: expected ${exp.ready}, got ${trust.ready}`, criticalFalseExported: false };
  }
  if (trust.reason !== exp.reason) {
    return { detail: `reason: expected ${exp.reason}, got ${trust.reason}`, criticalFalseExported: false };
  }
  const disposition = trustDispositionFor(trust.reason);
  if (disposition !== exp.disposition) {
    return { detail: `disposition: expected ${exp.disposition}, got ${disposition}`, criticalFalseExported: false };
  }
  // Export consistency: the exporter's default policy must agree with trust.
  const manifest = manifestFor(input.action, flags);
  let exportable = false;
  try {
    exportable = selectExportableActions(manifest).some((a) => a.id === input.action.id);
  } catch {
    exportable = false;
  }
  if (exportable !== exp.exportable_default) {
    const critical = exp.exportable_default === false && exportable === true;
    return {
      detail: `exportable_default: expected ${exp.exportable_default}, got ${exportable}`,
      criticalFalseExported: critical,
    };
  }
  return { criticalFalseExported: false };
}

function runTemporal(v: Vector): string | undefined {
  const input = v.input as { kind: Action["kind"]; temporal: Action["temporal"] };
  const exp = v.expected as {
    artifact: "VEVENT" | "VTODO" | null;
    executable_date?: string | null;
    comment_includes?: string;
  };
  const action: Action = {
    id: "act_001",
    kind: input.kind,
    title: "conformance temporal probe",
    modality: "required",
    actor: { certainty: "unknown" },
    temporal: input.temporal,
    evidence: [{ source_id: "conf", text: "quote" }],
    inference: "explicit",
    status: "verified",
  };
  const manifest = manifestFor(action, {
    evidence_supported: true,
    temporal_supported: true,
    actor_supported: true,
    modality_supported: true,
    source_hash_matched: true,
    negation_conflict: false,
    page_refs_valid: true,
    passed: true,
    actions: [passedPerAction("act_001") as never],
  });
  const ics = exportIcs(manifest, { now: FIXED_NOW });
  const artifact = exp.artifact;
  if (artifact === null) {
    if (ics.includes("BEGIN:VEVENT") || ics.includes("BEGIN:VTODO")) {
      return "expected no artifact, got one";
    }
  } else {
    if (!ics.includes(`BEGIN:${artifact}`)) return `expected ${artifact}, none emitted`;
  }
  const expectedDate = exp.executable_date ?? null;
  const dateMatch = ics.match(/^(?:DTSTART|DUE);VALUE=DATE:(\d+)$/m);
  const actualDate = dateMatch?.[1] ?? null;
  if (actualDate !== expectedDate) {
    return `executable_date: expected ${expectedDate}, got ${actualDate}`;
  }
  if (exp.comment_includes && !ics.includes(exp.comment_includes)) {
    return `expected COMMENT containing "${exp.comment_includes}"`;
  }
  return undefined;
}

async function runIcs(v: Vector, root: string): Promise<string | undefined> {
  const input = v.input as {
    manifest: ActionManifest;
    options?: { now?: string; include?: "verified-only" | "all" };
  };
  const exp = v.expected as {
    export_error?: string;
    golden?: string;
    contains?: string[];
    not_contains?: string[];
    max_octets_per_line?: number;
    crlf_only?: boolean;
    uid_pattern?: string;
    uid_not_contains?: string;
    artifact_counts?: Record<string, number>;
  };
  let ics: string;
  try {
    ics = exportIcs(input.manifest, {
      now: input.options?.now ? new Date(input.options.now) : FIXED_NOW,
      ...(input.options?.include ? { include: input.options.include } : {}),
    });
  } catch (e) {
    if (exp.export_error) {
      const code = e instanceof ActionManifestError ? e.code : "UNKNOWN";
      return code === exp.export_error
        ? undefined
        : `expected export error ${exp.export_error}, got ${code}`;
    }
    return `unexpected export error: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (exp.export_error) return `expected export error ${exp.export_error}, but export succeeded`;

  if (exp.golden) {
    const golden = await readFile(join(root, "vectors", "ics", exp.golden), "utf8");
    if (ics !== golden) return `golden mismatch (${exp.golden})`;
  }
  for (const s of exp.contains ?? []) {
    if (!ics.includes(s)) return `expected output to contain ${JSON.stringify(s)}`;
  }
  for (const s of exp.not_contains ?? []) {
    if (ics.includes(s)) return `expected output NOT to contain ${JSON.stringify(s)}`;
  }
  if (exp.max_octets_per_line) {
    for (const line of ics.split("\r\n")) {
      const n = Buffer.byteLength(line, "utf8");
      if (n > exp.max_octets_per_line) return `physical line exceeds ${exp.max_octets_per_line} octets (${n})`;
    }
  }
  if (exp.crlf_only && /(?<!\r)\n|\r(?!\n)/.test(ics)) {
    return "bare LF or bare CR found (CRLF-only required)";
  }
  if (exp.uid_pattern) {
    const uids = [...ics.replace(/\r\n[ \t]/g, "").matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!);
    const re = new RegExp(exp.uid_pattern);
    if (uids.length === 0 || !uids.every((u) => re.test(u))) {
      return `UID pattern ${exp.uid_pattern} not satisfied by ${uids.join(",")}`;
    }
  }
  if (exp.uid_not_contains) {
    const uids = [...ics.replace(/\r\n[ \t]/g, "").matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!);
    if (uids.some((u) => u.includes(exp.uid_not_contains!))) {
      return `UID leaks raw source id fragment ${exp.uid_not_contains}`;
    }
  }
  for (const [artifact, count] of Object.entries(exp.artifact_counts ?? {})) {
    // Line-anchored: escaped text inside a property value (e.g. a hostile
    // title containing "BEGIN:VEVENT") must not count as a real artifact.
    const actual = (ics.match(new RegExp(`^BEGIN:${artifact}$`, "gm")) ?? []).length;
    if (actual !== count) return `expected ${count} ${artifact}, got ${actual}`;
  }
  return undefined;
}

// ---------- suite driver ----------

export async function runConformance(
  root: string,
  options: { smoke?: boolean } = {},
): Promise<ConformanceReport> {
  const suite = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as SuiteManifest;
  let vectors = await loadVectors(root);
  if (options.smoke) {
    vectors = vectors.filter((v) => suite.smoke_profiles.includes(v.profile));
  }

  const results: VectorResult[] = [];
  let criticalFalseExported = 0;

  for (const v of vectors) {
    let detail: string | undefined;
    let critical = false;
    switch (v.profile) {
      case "schema":
        detail = runSchema(v);
        break;
      case "canonical-document":
        detail = runCanonicalDocument(v);
        break;
      case "evidence":
        detail = runEvidence(v);
        break;
      case "trust": {
        const r = runTrust(v);
        detail = r.detail;
        critical = r.criticalFalseExported;
        break;
      }
      case "temporal":
        detail = runTemporal(v);
        break;
      case "ics":
        detail = await runIcs(v, root);
        critical = Boolean(
          detail && /exportable|artifact|disposition/i.test(detail) && v.id.includes("trust"),
        );
        break;
      default:
        detail = `unknown profile: ${v.profile}`;
    }
    if (critical) criticalFalseExported += 1;
    results.push({ id: v.id, profile: v.profile, passed: !detail, critical, ...(detail ? { detail } : {}) });
  }

  const profiles: ConformanceReport["profiles"] = {};
  for (const r of results) {
    const p = (profiles[r.profile] ??= { passed: 0, total: 0 });
    p.total += 1;
    if (r.passed) p.passed += 1;
  }
  const passed = results.filter((r) => r.passed).length;
  return {
    suite_version: suite.suite_version,
    result: passed === results.length && criticalFalseExported === 0 ? "conformant" : "non-conformant",
    profiles,
    totals: { passed, total: results.length },
    critical_false_exported: criticalFalseExported,
    failures: results
      .filter((r) => !r.passed)
      .map((r) => ({ id: r.id, profile: r.profile, detail: r.detail ?? "" })),
  };
}

export function formatConformance(report: ConformanceReport): string {
  const lines = [`ActionManifest Conformance (suite ${report.suite_version})`];
  for (const [profile, p] of Object.entries(report.profiles)) {
    lines.push(
      `${profile.padEnd(20)} ${String(p.passed).padStart(3)}/${p.total} ${p.passed === p.total ? "PASS" : "FAIL"}`,
    );
  }
  lines.push(
    `${"TOTAL".padEnd(20)} ${String(report.totals.passed).padStart(3)}/${report.totals.total} ${report.result === "conformant" ? "PASS" : "FAIL"}`,
  );
  lines.push(`Critical false exported: ${report.critical_false_exported} (MUST be 0)`);
  lines.push(report.result === "conformant" ? "CONFORMANT" : "NON-CONFORMANT");
  for (const f of report.failures) {
    lines.push(`  FAIL ${f.id}: ${f.detail}`);
  }
  return lines.join("\n");
}
