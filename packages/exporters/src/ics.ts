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

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict calendar-date gate at the export trust boundary. Only a real
 * YYYY-MM-DD calendar date becomes DTSTART/DUE — `2026-13-40`, `2026/10/15`,
 * `foo`, or `2026-02-31` never reach the calendar, even if a manifest was
 * hand-built or produced by a broken third-party extractor.
 */
function icsDate(iso: string): string | undefined {
  if (!ISO_DATE.test(iso)) return undefined;
  const [y, m, d] = iso.split("-").map(Number);
  const probe = new Date(Date.UTC(y!, m! - 1, d!));
  if (
    probe.getUTCFullYear() !== y ||
    probe.getUTCMonth() !== m! - 1 ||
    probe.getUTCDate() !== d
  ) {
    return undefined;
  }
  return `${y}${String(m!).padStart(2, "0")}${String(d!).padStart(2, "0")}`;
}

function icsStamp(d = new Date()): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * RFC 5545 TEXT escaping. Backslash/comma/semicolon are escaped; CR, LF, and
 * CRLF all become the escaped `\n` sequence, so user-derived text can never
 * inject a new content line (property injection) into the calendar stream.
 * Other C0/C1 control characters (except TAB, which is legal WSP) are
 * stripped — they cannot be represented in a content line.
 */
function escapeText(value: string): string {
  // eslint-disable-next-line no-control-regex
  const sanitized = value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-]/g, "");
  return sanitized
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Truncate without splitting a surrogate pair. */
function truncateCodePoints(s: string, max: number): string {
  return [...s].slice(0, max).join("");
}

function evidenceNote(action: Action): string {
  const quotes = action.evidence.map((e) => e.text).join(" | ");
  const conditions = action.conditions?.length ? ` Conditions: ${action.conditions.join("; ")}` : "";
  return escapeText(truncateCodePoints(`${quotes}${conditions}`, 500));
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
  if (t.date) return icsDate(t.date);
  if (t.end) return icsDate(t.end);
  return undefined;
}

function conditionalAlternative(t?: Temporal): (Temporal & { date: string }) | undefined {
  const alt =
    t?.alternatives?.find((a) => a.date && a.type === "conditional") ??
    t?.alternatives?.find((a) => a.date);
  if (!alt?.date || !icsDate(alt.date)) return undefined;
  return alt as Temporal & { date: string };
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

const utf8 = new TextEncoder();

/**
 * RFC 5545 §3.1 content-line folding, octet-aware: every physical line is at
 * most 75 UTF-8 OCTETS (the CRLF delimiter is not counted), continuation
 * lines start with one SPACE (which counts toward the 75), and a multi-byte
 * UTF-8 sequence is never split across lines. Package-internal (not exported
 * from the package entry point); the conformance suite verifies folding via
 * the emitted calendar stream.
 */
export function foldContentLine(line: string): string {
  if (utf8.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  let budget = 75;
  for (const char of line) {
    const charOctets = utf8.encode(char).length;
    if (octets + charOctets > budget) {
      parts.push(current);
      current = " ";
      octets = 1;
      budget = 75;
    }
    current += char;
    octets += charOctets;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/** Inverse of folding (RFC 5545 §3.1): remove CRLF followed by SPACE/HTAB. */
export function unfoldContentLines(folded: string): string {
  return folded.replace(/\r\n[ \t]/g, "");
}

export interface IcsExportOptions extends ExportPolicyOptions {
  /**
   * Injectable clock for DTSTAMP. Defaults to the current time; pass a fixed
   * Date for deterministic, byte-identical output (conformance vectors).
   */
  now?: Date;
}

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
  const stamp = icsStamp(options.now);
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
      lines.push(`DTSTART;VALUE=DATE:${primary}`);
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
      lines.push(`DUE;VALUE=DATE:${primary}`);
      lines.push(...trustMarkers);
      lines.push(`SUMMARY:${escapeText(action.title)}`);
      lines.push(`DESCRIPTION:${evidenceNote(action)}`);
      lines.push("STATUS:NEEDS-ACTION");
      lines.push("END:VTODO");
    }
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldContentLine).join("\r\n") + "\r\n";
}
