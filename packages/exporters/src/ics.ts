import type { Action, ActionManifest, Temporal } from "@actionmanifest/core";

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

/**
 * Export events as VEVENT and dated tasks as VTODO.
 * Approximate temporals without a calendar day are omitted (unknown stays unknown).
 */
export function exportIcs(manifest: ActionManifest): string {
  const stamp = icsStamp();
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Action Manifest//Phase 1//EN",
    "CALSCALE:GREGORIAN",
  ];

  for (const action of manifest.actions) {
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

    if (isEvent) {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${action.id}@actionmanifest`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(primary)}`);
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
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("STATUS:NEEDS-ACTION");
      lines.push("END:VTODO");
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
