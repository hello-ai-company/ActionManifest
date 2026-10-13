import { PlainTextAdapter } from "@actionmanifest/adapters";
import { DeterministicProvider, extractActions } from "@actionmanifest/extractor";
import { verifyManifest } from "@actionmanifest/verifier";
import { expect, it } from "vitest";
import {
  createAssistanceState, registerAssistanceDocument, planLocalPreparation,
  MemoryLocalWorkflowHost, LocalWorkflowCoordinator, previewLocalWorkflowImpact,
  adviseLocalWorkflowRecovery, formatLocalWorkflowImpact, formatLocalWorkflowRecovery,
  WORKFLOW_INSIGHT_LIMITS, type WorkflowContext,
} from "@actionmanifest/consumer";
const now = "2026-10-11T10:00:00.000Z";
async function fixture() {
  const text = "遠足は2026年10月14日に実施します。\n参加票を2026年10月15日までに提出してください。";
  const doc = await new PlainTextAdapter().toCanonical({ kind: "text", id: "11111111-1111-4111-8111-111111111111", text, language: "ja" });
  const manifest = verifyManifest(await extractActions(doc, { provider: new DeterministicProvider(doc) }), doc).manifest;
  const context: WorkflowContext = {
    assistance: registerAssistanceDocument(createAssistanceState("built-insights"), manifest, text, doc.id, "school", [], 0),
    profiles: [{ profile_id: "profile", scope_key: "school", facts: [] }], rules: [],
    permissions: { revision: 1, grants: [{ destination_id: "tasks", scope_key: "school", operation: "local.task.create" }, { destination_id: "schedule", scope_key: "school", operation: "local.schedule.create" }] },
    destinations: [{ destination_id: "tasks", scope_key: "school", kind: "task_list", locality: "device_local", revision: 0 }, { destination_id: "schedule", scope_key: "school", kind: "schedule", locality: "device_local", revision: 0 }],
  };
  const plan = planLocalPreparation(context, { intent: "Prepare the notices", profile_id: "profile", scope_key: "school", start_date: "2026-01-01", end_date: "2026-12-31", task_destination_id: "tasks", schedule_destination_id: "schedule", now });
  const host = new MemoryLocalWorkflowHost(context, () => now);
  return { context, plan, host, coordinator: new LocalWorkflowCoordinator(host) };
}
it("exposes bounded impact previews through the built public entry without authorizing anything", async () => {
  const { context, plan, host } = await fixture(); const before = host.exportSnapshot();
  const report = previewLocalWorkflowImpact(plan, { now, context });
  expect(report.counts.planned).toBe(2);
  expect(report.counts.planned).toBe(plan.steps.length);
  expect(report.destinations.flatMap(group => group.changes)).toHaveLength(plan.steps.length);
  expect(report.authority.execution_allowed).toBe(false);
  expect(report.freshness.context).toBe("matches_snapshot");
  expect(host.exportSnapshot()).toBe(before);
  expect(formatLocalWorkflowImpact(plan, { now })).toContain("Display only");
  expect(WORKFLOW_INSIGHT_LIMITS.priorWorkflows).toBe(16);
});
it("keeps recovery inspection read-only and omits all authorization material", async () => {
  const { context, plan, host, coordinator } = await fixture();
  const workflow = await coordinator.create(plan);
  const challenge = await coordinator.requestConfirmation(workflow.workflow_id);
  const stored = await host.load(workflow.workflow_id); const before = host.exportSnapshot();
  const report = adviseLocalWorkflowRecovery(JSON.stringify(stored), { now, context });
  expect(report.confirmation).toBe("unconsumed"); expect(report.advice).toContain("renew_confirmation");
  expect(JSON.stringify(report)).not.toContain(challenge.token);
  expect(JSON.stringify(report)).not.toContain(stored!.authorization!.token_digest);
  expect(host.exportSnapshot()).toBe(before);
  expect(formatLocalWorkflowRecovery(JSON.stringify(stored), { now })).toContain("No execution authorization");
});
it("identifies stale destination snapshots and never re-enables cancellation", async () => {
  const { context, plan, host, coordinator } = await fixture();
  const workflow = await coordinator.create(plan);
  await coordinator.cancel(workflow.workflow_id);
  const changed = structuredClone(context); changed.destinations[0]!.revision++;
  expect(previewLocalWorkflowImpact(plan, { now, context: changed }).freshness.context).toBe("not_current");
  const report = adviseLocalWorkflowRecovery(JSON.stringify(await host.load(workflow.workflow_id)), { now, context: changed });
  expect(report.advice).toContain("preserve_cancelled_state");
  expect(report.advice).not.toContain("renew_confirmation");
  expect(report.authority.real_world_completion).toBe(false);
});
it("rejects corrupted plans through public entry points rather than presenting trusted impact", async () => {
  const { plan } = await fixture(); plan.steps[0]!.args.title = "not the reviewed plan";
  expect(() => previewLocalWorkflowImpact(plan, { now })).toThrow();
});
