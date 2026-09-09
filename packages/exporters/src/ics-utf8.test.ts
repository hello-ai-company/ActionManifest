import { describe, expect, it } from "vitest";
import { foldContentLine, unfoldContentLines } from "./ics.js";

/**
 * RFC 5545 §3.1: content lines are delimited by CRLF and SHOULD NOT be longer
 * than 75 OCTETS (not characters). Folding splits a long content line into
 * multiple lines, each continuation starting with a single SPACE. Splitting
 * must never break a UTF-8 multi-byte sequence.
 */

function physicalLines(folded: string): string[] {
  return folded.split("\r\n");
}

function assertOctetLimit(folded: string): void {
  for (const line of physicalLines(folded)) {
    expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
  }
}

function assertRoundTrip(original: string): void {
  const folded = foldContentLine(original);
  assertOctetLimit(folded);
  expect(unfoldContentLines(folded)).toBe(original);
}

describe("foldContentLine — octet-aware (RFC 5545 §3.1)", () => {
  it("does not fold ASCII lines of 74 and 75 octets", () => {
    expect(foldContentLine("A".repeat(74))).toBe("A".repeat(74));
    expect(foldContentLine("A".repeat(75))).toBe("A".repeat(75));
  });

  it("folds ASCII at 76 octets with a SPACE-prefixed continuation", () => {
    const folded = foldContentLine("A".repeat(76));
    const lines = physicalLines(folded);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe("A".repeat(75));
    expect(lines[1]).toBe(" A");
    assertOctetLimit(folded);
  });

  it("counts Japanese characters as 3 UTF-8 octets, not 1 character", () => {
    // 30 Japanese chars = 90 octets > 75 → must fold even though length < 75.
    const original = `SUMMARY:${"秋".repeat(30)}`;
    const folded = foldContentLine(original);
    expect(physicalLines(folded).length).toBeGreaterThan(1);
    assertOctetLimit(folded);
    expect(unfoldContentLines(folded)).toBe(original);
  });

  it("never splits a multi-byte UTF-8 sequence across physical lines", () => {
    const original = `DESCRIPTION:${"あいうえお".repeat(20)}`; // 300 octets of content
    const folded = foldContentLine(original);
    assertOctetLimit(folded);
    // Every physical line must be valid UTF-8 on its own (no split sequences).
    for (const line of physicalLines(folded)) {
      expect(Buffer.from(line, "utf8").toString("utf8")).toBe(line);
    }
    expect(unfoldContentLines(folded)).toBe(original);
  });

  it("handles mixed Japanese + ASCII", () => {
    assertRoundTrip(`SUMMARY:秋の遠足 excursion 2026 ${"x".repeat(60)} 持ち物確認`);
  });

  it("handles emoji (4-octet UTF-8 / surrogate pairs)", () => {
    assertRoundTrip(`SUMMARY:運動会 🎉🏃‍♀️ ${"日".repeat(40)}`);
  });

  it("handles emoji with variation selectors and combining characters", () => {
    assertRoundTrip(`SUMMARY:ハ゜ン（半濁点 combining） é café ☕︎ ${"〜".repeat(30)}`);
  });

  it("handles full-width punctuation and CJK mixes", () => {
    assertRoundTrip(`COMMENT:代替日は１０月２２日（雨天の場合）— rain date。、。${"！".repeat(40)}`);
  });

  it("folds 300+ byte lines multiple times", () => {
    const original = `DESCRIPTION:${"参加確認票を提出してください。".repeat(20)}`;
    const folded = foldContentLine(original);
    expect(physicalLines(folded).length).toBeGreaterThanOrEqual(4);
    assertOctetLimit(folded);
    expect(unfoldContentLines(folded)).toBe(original);
  });

  it("keeps short lines untouched", () => {
    expect(foldContentLine("BEGIN:VEVENT")).toBe("BEGIN:VEVENT");
  });

  it("property-based: random Unicode strings round-trip within octet limits", () => {
    // Deterministic PRNG (xorshift32) — no new dependency, reproducible runs.
    let state = 0x9e3779b9;
    const rand = () => {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      return (state >>> 0) / 0xffffffff;
    };
    const pools = [
      () => String.fromCharCode(0x20 + Math.floor(rand() * 0x5f)), // ASCII printable
      () => String.fromCharCode(0x3040 + Math.floor(rand() * 0x300)), // hiragana..katakana
      () => String.fromCharCode(0x4e00 + Math.floor(rand() * 0x1000)), // CJK
      () => String.fromCodePoint(0x1f300 + Math.floor(rand() * 0x200)), // emoji plane
      () => String.fromCharCode(0x300 + Math.floor(rand() * 0x70)), // combining marks
      () => String.fromCharCode(0xff00 + Math.floor(rand() * 0x60)), // full-width
    ];
    for (let i = 0; i < 500; i++) {
      const len = Math.floor(rand() * 220);
      let s = "SUMMARY:";
      for (let j = 0; j < len; j++) s += pools[Math.floor(rand() * pools.length)]!();
      assertRoundTrip(s);
    }
  });
});
