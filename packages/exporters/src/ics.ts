import type { Action, ActionManifest, Temporal } from "@actionmanifest/core";
import {
  assertExportable,
  isExportableStatus,
  selectExportableActions,
  type ExportPolicyOptions,
} from "./policy.js";

function icsDate(iso: string): string {
  return iso.replace(/-/g, "");
}

function icsStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

function evidenceNote(action: Action): string {
  const quotes = action.evidence.map((e) => e.text).join(" | ");
  const conditions = action.conditions?.length ? ` Conditions: ${action.conditions.join("; ")}` : "";
  return escapeText(`${quotes}${conditions}`.slice(0, 500));
}

function datesOf(t?: Temporal): string[] {
  if (!t) return [];
  const out: string[] = [];
  if (t.date && (t.type === "exact" || t.type === "conditional" || t.type === "range")) {
    out.push(t.date);
  }
  if (t.end && /^\d{4}-\d{2}-\d{2}$/.test(t.end)) out.push(t.end);
  for (const alt of t.alternatives ?? []) out.push(...datesOf(alt));
  return out;
}

function fold(line: string): string {
  if (line.length <= 74) return line;
  const chunks: string[] = [];
  let rest = line;
  chunks.push(rest.slice(0, 74));
  rest = rest.slice(74);
  while (rest.length) {
    chunks.push(` ${rest.slice(0, 73)}`);
    rest = rest.slice(73);
  }
  return chunks.join("\r\n");
}

export type IcsExportOptions = ExportPolicyOptions;

/**
 * Export events as VEVENT and dated tasks as VTODO.
 *
 * Safety contract (Phase 2):
 * - Default policy is verified-only: proposed/rejected Actions are NOT
 *   exported. `include: "all"` is the explicit opt-in and marks unverified
 *   entries with `X-ACTIONMANIFEST-STATUS`.
 * - A manifest-level fatal receipt (hash mismatch / empty source) throws
 *   ExportError instead of producing any executable output.
 * - Approximate temporals without a calendar day are omitted (unknown stays
 *   unknown); conditional alternatives never overwrite the primary date.
 */
export function exportIcs(manifest: ActionManifest, options: IcsExportOptions = {}): string {
  assertExportable(manifest);
  const include = options.include ?? "verified-only";
  const stamp = icsStamp();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Action Manifest//Phase 2//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const action of selectExportableActions(manifest, { include })) {
    const dates = datesOf(action.temporal);
    const primary = dates[0];
    const isEvent = action.kind === "event" || action.kind === "attend";
    const isTodo =
      action.kind === "submit" ||
      action.kind === "prepare" ||
      action.kind === "pay" ||
      action.kind === "deadline" ||
      action.kind === "sign" ||
      action.kind === "reply";

    if (!primary) continue;
    const unverifiedMarker = isExportableStatus(action.status)
      ? undefined
      : `X-ACTIONMANIFEST-STATUS:${action.status}`;

    if (isEvent) {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${action.id}@actionmanifest`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(primary)}`);
      if (unverifiedMarker) lines.push(unverifiedMarker);
      const rain = action.temporal?.alternatives?.find((a) => a.date);
      if (rain?.date) {
        lines.push(`COMMENT:${escapeText(`alternative ${rain.date} if ${rain.condition ?? "condition"}`)}`);
      }
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("END:VEVENT");
    } else if (isTodo) {
      lines.push("BEGIN:VTODO");
      lines.push(`UID:${action.id}@actionmanifest`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DUE;VALUE=DATE:${icsDate(primary)}`);
      if (unverifiedMarker) lines.push(unverifiedMarker);
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("STATUS:NEEDS-ACTION");
      lines.push("END:VTODO");
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
