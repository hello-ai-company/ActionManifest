import {
  sha256Hex,
  trustDispositionFor,
  type Action,
  type ActionManifest,
  type Temporal,
} from "@actionmanifest/core";
import {
  assertExportable,
  evaluateExportTrust,
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

/**
 * Executable date policy (normative):
 * - `exact` / `range` with a calendar `date` → executable (DTSTART / DUE).
 *   An ISO `end` is accepted as the deadline day when `date` is absent.
 * - `approximate`, `relative`, `unknown` → never executable (unknown stays
 *   unknown).
 * - `conditional` at the TOP level → never executable: the date holds only
 *   when the condition holds, so no VEVENT/VTODO is produced at all.
 * - `alternatives` never contribute the primary date; a dated conditional
 *   alternative is preserved as a COMMENT on the primary artifact only.
 */
function primaryDate(t?: Temporal): string | undefined {
  if (!t) return undefined;
  if (t.type !== "exact" && t.type !== "range") return undefined;
  if (t.date) return t.date;
  if (t.end && /^\d{4}-\d{2}-\d{2}$/.test(t.end)) return t.end;
  return undefined;
}

function conditionalAlternative(t?: Temporal): Temporal | undefined {
  return t?.alternatives?.find((a) => a.date && a.type === "conditional") ??
    t?.alternatives?.find((a) => a.date);
}

/**
 * Globally stable, opaque UID. Action ids are manifest-local (`act_001`
 * recurs across documents), so the UID is derived from the source identity +
 * the action id, hashed: the raw source id (which may contain sensitive
 * filenames) never appears in calendar output. Same document + same action
 * → same UID; different document or different action → different UID.
 * Deliberately keyed on source.id (logical identity), not source.hash
 * (content revision) — see docs/adr/0004-integration-contract.md.
 */
export function actionUid(manifest: ActionManifest, action: Action): string {
  return `${sha256Hex(`${manifest.source.id}:${action.id}`)}@actionmanifest`;
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
 * Safety contract (Phase 2, hardened):
 * - Default policy exports only trust-qualified Actions (consumer disposition
 *   "ready"): per-Action verification passed, verified-tier status, no
 *   manifest-level fatal. `include: "all"` is the explicit audit opt-in and
 *   marks every entry with `X-ACTIONMANIFEST-STATUS` and
 *   `X-ACTIONMANIFEST-DISPOSITION`.
 * - A manifest-level fatal receipt (hash mismatch / empty source) throws
 *   ExportError instead of producing any executable output.
 * - Conditional information is not an executable date: top-level conditional
 *   temporals produce no DTSTART/DUE (and no VEVENT/VTODO); conditional
 *   alternatives stay COMMENT annotations on the primary artifact.
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

  const trusted = evaluateExportTrust(manifest).filter((t) =>
    include === "all" ? true : t.trust.ready,
  );

  for (const { action, trust } of trusted) {
    const primary = primaryDate(action.temporal);
    const isEvent = action.kind === "event" || action.kind === "attend";
    const isTodo =
      action.kind === "submit" ||
      action.kind === "prepare" ||
      action.kind === "pay" ||
      action.kind === "deadline" ||
      action.kind === "sign" ||
      action.kind === "reply";

    // No unconditional primary date → no calendar artifact at all.
    if (!primary) continue;

    const trustMarkers =
      include === "all"
        ? [
            `X-ACTIONMANIFEST-STATUS:${action.status}`,
            `X-ACTIONMANIFEST-DISPOSITION:${trustDispositionFor(trust.reason)}`,
          ]
        : [];

    if (isEvent) {
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${actionUid(manifest, action)}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DTSTART;VALUE=DATE:${icsDate(primary)}`);
      lines.push(...trustMarkers);
      const alt = conditionalAlternative(action.temporal);
      if (alt?.date) {
        lines.push(`COMMENT:${escapeText(`alternative ${alt.date} if ${alt.condition ?? "condition"}`)}`);
      }
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("END:VEVENT");
    } else if (isTodo) {
      lines.push("BEGIN:VTODO");
      lines.push(`UID:${actionUid(manifest, action)}`);
      lines.push(`DTSTAMP:${stamp}`);
      lines.push(`DUE;VALUE=DATE:${icsDate(primary)}`);
      lines.push(...trustMarkers);
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("STATUS:NEEDS-ACTION");
      lines.push("END:VTODO");
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
