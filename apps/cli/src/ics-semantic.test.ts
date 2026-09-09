import { describe, expect, it } from "vitest";
import { matchComponents, parseIcs, type ExpectedComponent } from "./ics-semantic.js";

/**
 * Universal ICS conformance is SEMANTIC, not byte-level: RFC 5545 explicitly
 * allows implementations to differ in property ordering, PRODID value, legal
 * fold positions, and other semantics-preserving serialization details.
 * These tests prove the comparator accepts such differences and rejects
 * genuinely normative violations.
 */

const REFERENCE = [
  "BEGIN:VCALENDAR",
  "VERSION:2.0",
  "PRODID:-//Action Manifest//Phase 2//EN",
  "CALSCALE:GREGORIAN",
  "BEGIN:VEVENT",
  "UID:3c96dd90@actionmanifest",
  "DTSTAMP:20260101T000000Z",
  "DTSTART;VALUE=DATE:20261015",
  "COMMENT:alternative 2026-10-22 if 雨天",
  "SUMMARY:秋の遠足",
  "DESCRIPTION:令和8年10月15日に秋の遠足を実施します。",
  "END:VEVENT",
  "END:VCALENDAR",
  "",
].join("\r\n");

const EXPECTED: ExpectedComponent[] = [
  {
    type: "VEVENT",
    props: {
      UID: ["3c96dd90@actionmanifest"],
      "DTSTART;VALUE=DATE": ["20261015"],
      SUMMARY: ["秋の遠足"],
      COMMENT: ["alternative 2026-10-22 if 雨天"],
    },
  },
];

describe("parseIcs", () => {
  it("parses components and properties", () => {
    const cal = parseIcs(REFERENCE);
    expect(cal.type).toBe("VCALENDAR");
    expect(cal.children).toHaveLength(1);
    const ev = cal.children[0]!;
    expect(ev.type).toBe("VEVENT");
    expect(ev.props.get("DTSTART;VALUE=DATE")).toEqual(["20261015"]);
  });

  it("rejects malformed streams", () => {
    expect(() => parseIcs("BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nEND:VCALENDAR\r\n")).toThrowError();
    expect(() => parseIcs("not a content line")).toThrowError();
  });
});

describe("matchComponents — universal semantic equivalence", () => {
  it("A: different property order is equivalent", () => {
    const reordered = [
      "BEGIN:VCALENDAR",
      "PRODID:-//Action Manifest//Phase 2//EN",
      "VERSION:2.0",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      "SUMMARY:秋の遠足",
      "DESCRIPTION:令和8年10月15日に秋の遠足を実施します。",
      "COMMENT:alternative 2026-10-22 if 雨天",
      "DTSTART;VALUE=DATE:20261015",
      "DTSTAMP:20260101T000000Z",
      "UID:3c96dd90@actionmanifest",
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    expect(matchComponents(parseIcs(reordered), EXPECTED)).toBeUndefined();
  });

  it("B: different PRODID is equivalent", () => {
    const otherProdid = REFERENCE.replace(
      "PRODID:-//Action Manifest//Phase 2//EN",
      "PRODID:-//Example Corp//ActionManifest Python//EN",
    );
    expect(matchComponents(parseIcs(otherProdid), EXPECTED)).toBeUndefined();
  });

  it("C: different legal fold position is equivalent after unfold", () => {
    // Same logical SUMMARY, folded at a different (legal) boundary.
    const folded = REFERENCE.replace(
      "DESCRIPTION:令和8年10月15日に秋の遠足を実施します。",
      "DESCRIPTION:令和8年10月15日に\r\n 秋の遠足を実施します。",
    );
    expect(matchComponents(parseIcs(folded), EXPECTED)).toBeUndefined();
  });

  it("C2: DTSTAMP lexical position/value differences are not normative", () => {
    const otherStamp = REFERENCE
      .replace("DTSTAMP:20260101T000000Z", "DTSTAMP:20300101T120000Z")
      .replace("UID:3c96dd90@actionmanifest\r\nDTSTAMP:20300101T120000Z", "DTSTAMP:20300101T120000Z\r\nUID:3c96dd90@actionmanifest");
    expect(matchComponents(parseIcs(otherStamp), EXPECTED)).toBeUndefined();
  });

  it("D: normative differences FAIL — wrong executable date", () => {
    const wrongDate = REFERENCE.replace("DTSTART;VALUE=DATE:20261015", "DTSTART;VALUE=DATE:20261022");
    expect(matchComponents(parseIcs(wrongDate), EXPECTED)).toMatch(/DTSTART/);
  });

  it("D: normative differences FAIL — missing SUMMARY value", () => {
    const wrongSummary = REFERENCE.replace("SUMMARY:秋の遠足", "SUMMARY:健康診断");
    expect(matchComponents(parseIcs(wrongSummary), EXPECTED)).toMatch(/SUMMARY/);
  });

  it("D: normative differences FAIL — missing component", () => {
    const noEvent = REFERENCE.replace(/BEGIN:VEVENT[\s\S]*?END:VEVENT\r\n/, "");
    expect(matchComponents(parseIcs(noEvent), EXPECTED)).toMatch(/VEVENT/);
  });

  it("D: forbidden property present fails", () => {
    const withRrule = REFERENCE.replace(
      "END:VEVENT",
      "RRULE:FREQ=DAILY\r\nEND:VEVENT",
    );
    expect(
      matchComponents(parseIcs(withRrule), [{ ...EXPECTED[0]!, forbid_props: ["RRULE"] }]),
    ).toMatch(/RRULE/);
  });

  it("extra properties (X-*) are tolerated", () => {
    const withX = REFERENCE.replace(
      "END:VEVENT",
      "X-SOME-IMPL-DETAIL:whatever\r\nEND:VEVENT",
    );
    expect(matchComponents(parseIcs(withX), EXPECTED)).toBeUndefined();
  });
});
