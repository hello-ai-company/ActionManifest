/**
 * Executable example — per-Action verification (schema 0.2.0).
 *
 * Shows the core safety property: one bad Action never invalidates the good
 * ones. A hallucinated deadline (not supported by the source) fails its own
 * verification while the supported Action still verifies — and the default
 * export policy ships only the verified one.
 *
 * Typechecked and executed in CI (`pnpm docs:examples`). Deterministic.
 */
import { PlainTextAdapter } from "@actionmanifest/adapters";
import { verifyManifest, verificationPassed } from "@actionmanifest/verifier";
import { exportIcs, selectExportableActions } from "@actionmanifest/exporters";
import { validateActionManifest, type Action } from "@actionmanifest/core";

const text = "令和8年10月15日に秋の遠足を実施します。";
const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "notice-1", text });

const supported: Action = {
  id: "act_ok",
  kind: "event",
  title: "秋の遠足を実施する",
  modality: "required",
  actor: { certainty: "unknown" },
  temporal: { type: "exact", date: "2026-10-15", raw_text: "令和8年10月15日" },
  evidence: [{ source_id: "notice-1", text }],
  inference: "explicit",
  status: "proposed",
};

// A deadline the source never states — the classic hallucination shape.
const hallucinated: Action = {
  ...supported,
  id: "act_hallucinated",
  title: "存在しない締切を提出する",
  kind: "submit",
  temporal: { type: "exact", date: "2026-11-30", raw_text: "11月30日" },
};

const candidate = validateActionManifest({
  schema_version: "0.2.0",
  source: { id: "notice-1" },
  actions: [supported, hallucinated],
});

const { manifest, flags } = verifyManifest(candidate, doc);

// Manifest verdict is a summary, not a gate: PARTIAL pass here.
if (verificationPassed(flags)) throw new Error("expected partial verification");
const byId = new Map((flags.actions ?? []).map((r) => [r.action_id, r]));
if (byId.get("act_ok")?.passed !== true) throw new Error("supported action must verify");
if (byId.get("act_hallucinated")?.passed !== false) {
  throw new Error("hallucinated deadline must fail verification");
}

// Default export is verified-only: the failed Action never reaches the calendar.
const exported = selectExportableActions(manifest);
if (exported.length !== 1 || exported[0]!.id !== "act_ok") {
  throw new Error("export policy must ship only the verified action");
}
const ics = exportIcs(manifest);
if (ics.includes("20261130")) throw new Error("hallucinated date leaked into ICS");

console.log("per-action-verification OK: 1 verified + exported, 1 failed + withheld");
