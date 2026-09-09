import { describe, expect, it } from "vitest";
import {
  ExportError,
  SCHEMA_VERSION,
  type Action,
  type ActionManifest,
  type ActionVerificationResult,
  type VerificationFlags,
} from "@actionmanifest/core";
import { exportIcs, exportJson } from "./index.js";

/**
 * Export trust semantics (Phase 2 pre-merge hardening).
 * Export is consumption: the default policy exports only trust-qualified
 * (consumer-disposition "ready") Actions — never status alone.
 */

function makeAction(partial: Partial<Action> & Pick<Action, "id" | "kind" | "title">): Action {
  return {
    modality: "required",
    actor: { certainty: "unknown" },
    evidence: [{ source_id: "s", text: "quote" }],
    inference: "explicit",
    status: "proposed",
    ...partial,
  };
}

function perAction(id: string, passed: boolean): ActionVerificationResult {
  return {
    action_id: id,
    passed,
    evidence_supported: passed,
    temporal_supported: passed,
    actor_supported: true,
    modality_supported: true,
    negation_conflict: false,
    page_refs_valid: true,
    issues: passed
      ? []
      : [{ code: "TEMPORAL_UNSUPPORTED", message: "declared date not in evidence", action_id: id }],
  };
}

function receipt(partial: Partial<VerificationFlags>): ActionManifest["receipt"] {
  return {
    extraction: {
      provider: "t",
      model: "t",
      extractor_version: "0",
      schema_version: SCHEMA_VERSION,
      created_at: "t",
    },
    verification: {
      evidence_supported: true,
      temporal_supported: true,
      actor_supported: true,
      modality_supported: true,
      source_hash_matched: true,
      negation_conflict: false,
      page_refs_valid: true,
      passed: true,
      ...partial,
    },
  };
}

const datedEvent = (id: string, status: Action["status"]) =>
  makeAction({
    id,
    kind: "event",
    title: `event ${id}`,
    status,
    temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日" },
  });

function manifestWith(actions: Action[], rcpt?: ActionManifest["receipt"]): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: "s", hash: "abc" },
    actions,
    ...(rcpt ? { receipt: rcpt } : {}),
  };
}

describe("export trust — default verified-only means trust-qualified", () => {
  it("A: status=verified + per-action passed=false → excluded from default JSON and ICS", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({ passed: false, temporal_supported: false, actions: [perAction("act_001", false)] }),
    );
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(0);
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });

  it("B: status=verified + verification receipt missing → excluded by default", () => {
    const m = manifestWith([datedEvent("act_001", "verified")]);
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(0);
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });

  it("C: status=proposed + per-action passed=true → excluded by default", () => {
    const m = manifestWith(
      [datedEvent("act_001", "proposed")],
      receipt({ actions: [perAction("act_001", true)] }),
    );
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(0);
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });

  it("D: status=verified + passed + no fatal → included by default", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({ actions: [perAction("act_001", true)] }),
    );
    expect(JSON.parse(exportJson(m)).actions).toHaveLength(1);
    expect(exportIcs(m)).toContain("BEGIN:VEVENT");
  });

  it("E: manifest-level fatal → ExportError for default and include:all", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({
        passed: false,
        source_hash_matched: false,
        actions: [perAction("act_001", true)],
        issues: [{ code: "SOURCE_HASH_MISMATCH", message: "hash mismatch" }],
      }),
    );
    expect(() => exportJson(m)).toThrowError(ExportError);
    expect(() => exportJson(m, { include: "all" })).toThrowError(ExportError);
    expect(() => exportIcs(m)).toThrowError(ExportError);
    expect(() => exportIcs(m, { include: "all" })).toThrowError(ExportError);
  });

  it("F: include:all keeps failed-but-status-verified actions with an explicit trust marker", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({ passed: false, temporal_supported: false, actions: [perAction("act_001", false)] }),
    );
    const ics = exportIcs(m, { include: "all" });
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("X-ACTIONMANIFEST-STATUS:verified");
    expect(ics).toContain("X-ACTIONMANIFEST-DISPOSITION:blocked");
    const json = JSON.parse(exportJson(m, { include: "all" })) as ActionManifest;
    expect(json.actions).toHaveLength(1);
    expect(json.receipt?.verification?.passed).toBe(false);
  });

  it("rejected actions are excluded by default and marked blocked under include:all", () => {
    const m = manifestWith(
      [datedEvent("act_001", "rejected")],
      receipt({ actions: [perAction("act_001", true)] }),
    );
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
    const ics = exportIcs(m, { include: "all" });
    expect(ics).toContain("X-ACTIONMANIFEST-STATUS:rejected");
    expect(ics).toContain("X-ACTIONMANIFEST-DISPOSITION:blocked");
  });

  it("v0.1 aggregate-only receipt: clean aggregate + verified status → exported", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({ actions: undefined }),
    );
    expect(exportIcs(m)).toContain("BEGIN:VEVENT");
  });

  it("v0.1 aggregate-only receipt: failing aggregate → not exported", () => {
    const m = manifestWith(
      [datedEvent("act_001", "verified")],
      receipt({ passed: false, temporal_supported: false, actions: undefined }),
    );
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });
});

describe("conditional temporal safety", () => {
  const conditionalEvent = (id: string) =>
    makeAction({
      id,
      kind: "event",
      title: "rain-only event",
      status: "verified",
      temporal: { type: "conditional", date: "2026-10-22", raw_text: "雨天の場合は10月22日", condition: "雨天" },
    });
  const trusted = (ids: string[]) => receipt({ actions: ids.map((id) => perAction(id, true)) });

  it("A: exact primary + conditional alternative → DTSTART is the primary only", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "event",
          title: "秋の遠足",
          status: "verified",
          temporal: {
            type: "exact",
            date: "2026-10-15",
            raw_text: "10月15日",
            alternatives: [
              { type: "conditional", date: "2026-10-22", raw_text: "雨天の場合は10月22日", condition: "雨天" },
            ],
          },
        }),
      ],
      trusted(["act_001"]),
    );
    const ics = exportIcs(m);
    expect(ics).toContain("DTSTART;VALUE=DATE:20261015");
    expect(ics).not.toContain("DTSTART;VALUE=DATE:20261022");
    expect(ics).toContain("COMMENT:alternative 2026-10-22");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
  });

  it("B: top-level conditional event → no DTSTART and no VEVENT at all", () => {
    const m = manifestWith([conditionalEvent("act_001")], trusted(["act_001"]));
    const ics = exportIcs(m);
    expect(ics).not.toContain("DTSTART");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });

  it("C: top-level conditional submit → no VTODO DUE", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "submit",
          title: "conditional submit",
          status: "verified",
          temporal: { type: "conditional", date: "2026-10-22", raw_text: "雨天なら10月22日まで", condition: "雨天" },
        }),
      ],
      trusted(["act_001"]),
    );
    const ics = exportIcs(m);
    expect(ics).not.toContain("BEGIN:VTODO");
    expect(ics).not.toContain("DUE");
  });

  it("D: approximate temporal → no executable date", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "event",
          title: "10月頃の予定",
          status: "verified",
          temporal: { type: "approximate", month: 10, raw_text: "10月頃" },
        }),
      ],
      trusted(["act_001"]),
    );
    expect(exportIcs(m)).not.toContain("BEGIN:VEVENT");
  });

  it("undated top-level with a dated conditional alternative → alternative must not become primary", () => {
    const m = manifestWith(
      [
        makeAction({
          id: "act_001",
          kind: "event",
          title: "undated with rain alternative",
          status: "verified",
          temporal: {
            type: "unknown",
            raw_text: "日時未定",
            alternatives: [
              { type: "conditional", date: "2026-10-22", raw_text: "雨天の場合は10月22日", condition: "雨天" },
            ],
          },
        }),
      ],
      trusted(["act_001"]),
    );
    const ics = exportIcs(m);
    expect(ics).not.toContain("DTSTART");
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("ICS UID — globally stable, opaque identity", () => {
  const trustedEvent = (id: string) =>
    makeAction({
      id,
      kind: "event",
      title: `event ${id}`,
      status: "verified",
      temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日" },
    });
  const trustedManifest = (sourceId: string, actions: Action[]): ActionManifest =>
    manifestWith(actions, receipt({ actions: actions.map((a) => perAction(a.id, true)) })) &&
    {
      ...manifestWith(actions, receipt({ actions: actions.map((a) => perAction(a.id, true)) })),
      source: { id: sourceId, hash: "h" },
    };

  function uids(ics: string): string[] {
    // RFC 5545 folding: continuation lines start with a space — unfold first,
    // exactly like a real calendar reader.
    const unfolded = ics.replace(/\r\n[ \t]/g, "");
    return [...unfolded.matchAll(/^UID:(.+)$/gm)].map((m) => m[1]!);
  }

  it("same document + same action → same UID across exports", () => {
    const m = trustedManifest("doc-A", [trustedEvent("act_001")]);
    expect(uids(exportIcs(m))).toEqual(uids(exportIcs(m)));
  });

  it("different document + same action id → different UID", () => {
    const a = trustedManifest("doc-A", [trustedEvent("act_001")]);
    const b = trustedManifest("doc-B", [trustedEvent("act_001")]);
    expect(uids(exportIcs(a))[0]).not.toBe(uids(exportIcs(b))[0]);
  });

  it("same source + different action id → different UID", () => {
    const m = trustedManifest("doc-A", [trustedEvent("act_001"), trustedEvent("act_002")]);
    const [u1, u2] = uids(exportIcs(m));
    expect(u1).not.toBe(u2);
  });

  it("UID is opaque: raw source id never appears", () => {
    const m = trustedManifest("student-name-school-2026.pdf", [trustedEvent("act_001")]);
    const ics = exportIcs(m);
    expect(ics).not.toContain("student-name-school-2026");
    expect(uids(ics)[0]).toMatch(/^[a-f0-9]{64}@actionmanifest$/);
  });
});
