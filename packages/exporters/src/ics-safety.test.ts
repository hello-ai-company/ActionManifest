import { describe, expect, it } from "vitest";
import {
  SCHEMA_VERSION,
  type Action,
  type ActionManifest,
} from "@actionmanifest/core";
import { exportIcs } from "./index.js";

/**
 * RFC 5545 transport safety: CRLF-only line endings, TEXT escaping against
 * property injection, control-character handling, strict date gating, and
 * deterministic DTSTAMP via the injectable clock.
 */

function makeAction(partial: Partial<Action> & Pick<Action, "id" | "kind" | "title">): Action {
  return {
    modality: "required",
    actor: { certainty: "unknown" },
    evidence: [{ source_id: "s", text: "quote" }],
    inference: "explicit",
    status: "verified",
    temporal: { type: "exact", date: "2026-10-15", raw_text: "10月15日" },
    ...partial,
  };
}

function trustedManifest(actions: Action[]): ActionManifest {
  return {
    schema_version: SCHEMA_VERSION,
    source: { id: "s", hash: "abc" },
    receipt: {
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
        actions: actions.map((a) => ({
          action_id: a.id,
          passed: true,
          evidence_supported: true,
          temporal_supported: true,
          actor_supported: true,
          modality_supported: true,
          negation_conflict: false,
          page_refs_valid: true,
          issues: [],
        })),
      },
    },
    actions,
  };
}

describe("CRLF line endings", () => {
  it("uses CRLF only — no bare LF or bare CR anywhere in the stream", () => {
    const ics = exportIcs(trustedManifest([makeAction({ id: "act_001", kind: "event", title: "秋の遠足" })]));
    expect(ics).toContain("\r\n");
    // Remove all CRLF; no stray \n or \r may remain.
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    // Every physical line respects the 75-octet limit.
    for (const line of ics.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
  });
});

describe("TEXT escaping / property-injection resistance", () => {
  it("CRLF in a title cannot inject a new VEVENT", () => {
    const evil = makeAction({
      id: "act_001",
      kind: "event",
      title: "遠足\r\nBEGIN:VEVENT\r\nDTSTART;VALUE=DATE:20990101\r\nSUMMARY:fake\r\nEND:VEVENT\r\n",
    });
    const ics = exportIcs(trustedManifest([evil]));
    // No NEW content line may appear: count line-anchored VEVENT boundaries.
    expect(ics.match(/^BEGIN:VEVENT$/gm)).toHaveLength(1);
    // The injected DTSTART never becomes a real content line; the genuine one wins.
    expect(ics.match(/^DTSTART;VALUE=DATE:(\d+)$/gm)).toEqual(["DTSTART;VALUE=DATE:20261015"]);
    // The hostile CRLFs became escaped \n sequences inside SUMMARY.
    expect(ics).toContain("遠足\\nBEGIN:VEVENT");
  });

  it("bare CR and LF are both neutralized", () => {
    const evil = makeAction({
      id: "act_001",
      kind: "event",
      title: "line1\rline2\nline3\r\nline4",
    });
    const ics = exportIcs(trustedManifest([evil]));
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(ics).toContain("line1\\nline2\\nline3\\nline4");
  });

  it("escapes backslash, comma, and semicolon", () => {
    const a = makeAction({
      id: "act_001",
      kind: "event",
      title: "C:\\path, room; A",
    });
    const ics = exportIcs(trustedManifest([a]));
    expect(ics).toContain("SUMMARY:C:\\\\path\\, room\\; A");
  });

  it("strips non-representable control characters but keeps TAB", () => {
    const a = makeAction({
      id: "act_001",
      kind: "event",
      title: "bell\u0007 and\u0008backspace\ttab\u000cok",
    });
    const ics = exportIcs(trustedManifest([a]));
    // BEL/BS/FF stripped; TAB (legal WSP) preserved.
    expect(ics).toContain("SUMMARY:bell andbackspace\ttabok");
    // eslint-disable-next-line no-control-regex
    expect(ics.replace(/\r\n/g, "")).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
  });
});

describe("strict calendar-date gate", () => {
  const cases: [string, string][] = [
    ["month 13", "2026-13-15"],
    ["day 40", "2026-10-40"],
    ["slash format", "2026/10/15"],
    ["garbage", "foo"],
    ["nonexistent day", "2026-02-31"],
  ];
  for (const [label, date] of cases) {
    it(`rejects ${label} (${date}) — no executable artifact`, () => {
      const a = makeAction({
        id: "act_001",
        kind: "event",
        title: "bad date",
        temporal: { type: "exact", date, raw_text: date },
      });
      const ics = exportIcs(trustedManifest([a]));
      expect(ics).not.toContain("BEGIN:VEVENT");
      expect(ics).not.toContain("DTSTART");
    });
  }

  it("accepts a leap day (2028-02-29)", () => {
    const a = makeAction({
      id: "act_001",
      kind: "event",
      title: "leap",
      temporal: { type: "exact", date: "2028-02-29", raw_text: "2月29日" },
    });
    expect(exportIcs(trustedManifest([a]))).toContain("DTSTART;VALUE=DATE:20280229");
  });
});

describe("DTSTAMP determinism", () => {
  it("same manifest + same injected clock → byte-identical ICS", () => {
    const m = trustedManifest([makeAction({ id: "act_001", kind: "event", title: "秋の遠足" })]);
    const now = new Date("2026-09-09T00:00:00.000Z");
    const a = exportIcs(m, { now });
    const b = exportIcs(m, { now });
    expect(a).toBe(b);
    expect(a).toContain("DTSTAMP:20260909T000000Z");
  });

  it("default clock still works (non-deterministic by design)", () => {
    const m = trustedManifest([makeAction({ id: "act_001", kind: "event", title: "秋の遠足" })]);
    expect(exportIcs(m)).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
  });
});
