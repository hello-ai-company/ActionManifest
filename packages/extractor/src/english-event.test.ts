import { describe, expect, it } from "vitest";
import { ensureSourceHash } from "@actionmanifest/core";
import { extractDeterministically } from "./deterministic.js";

describe("explicit English planning subjects", () => {
  it.each([
    ["The field trip was scheduled for October 15, 2026, but has been rescheduled to October 22, 2026.", "2026-10-22"],
    ["The field trip on October 22, 2026 has been rescheduled to October 15, 2026.", "2026-10-15"],
  ])("recognizes the event and keeps only the corrected date: %s", (text, date) => {
    const actions = extractDeterministically(ensureSourceHash({ id: "en-event", text }));
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ kind: "event", title: "field trip", temporal: { date }, status: "proposed" });
    expect(actions[0]?.evidence[0]?.text).toBe(text);
  });

  it("preserves around-November uncertainty without inventing a calendar day", () => {
    const [action] = extractDeterministically(ensureSourceHash({ id: "en-event", text: "Health checkups are planned for around November." }));
    expect(action).toMatchObject({ kind: "event", title: "Health checkups", temporal: { type: "approximate", month: 11 } });
    expect(action?.temporal?.date).toBeUndefined();
  });

  it("does not confuse the month May with a hypothetical modal", () => {
    const [action] = extractDeterministically(ensureSourceHash({ id: "en-event", text: "The field trip is scheduled for May 5, 2026." }));
    expect(action).toMatchObject({ kind: "event", temporal: { date: "2026-05-05" } });
  });

  it.each(["If the field trip is planned, details will follow.", "The field trip report was revised.", "The field trip was not planned.", "The field trip was scheduled last year.", "The field trip is cancelled.", "The field trip is planned for October 15, 2026 if approved.", "The field trip was scheduled, but was not rescheduled."])(
    "does not invent a planned event from hypothetical/reference/negative/completed text: %s", text => {
      const actions = extractDeterministically(ensureSourceHash({ id: "en-event", text }));
      expect(actions.some(action => action.kind === "event")).toBe(false);
    },
  );
});
