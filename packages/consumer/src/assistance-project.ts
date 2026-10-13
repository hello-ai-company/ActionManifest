import type { ActionReference, ActionRuleSet, AssistanceCompanion, AssistanceDocument, AssistanceState, LocalProfile, Predicate, PredicateResult, ReviewItem } from "./assistance-types.js";
import { ASSISTANCE_LIMITS, appendEvent, assertQuotes, assertReference, assertState, assertTimestamp, findAction, fingerprint, quotesFor, referenceKey, requireValue, stringValue } from "./assistance-common.js";
import { createPredicateEvaluator, validatePredicate } from "./assistance-conditions.js";
import { changeCards, changeTargetReferences, workflowStates } from "./assistance-ledger.js";
import { validateAssistanceCompanion } from "./assistance-wire.js";

function reviewItem(state: AssistanceState, input: Omit<ReviewItem, "item_id" | "fingerprint" | "status">, context: unknown = {}): ReviewItem {
  const hash = fingerprint({ ledger_id: state.ledger_id, input, context });
  const item_id = `review_${hash.slice(0, 24)}`;
  const decision = [...state.events].reverse().find(e => e.type === "review_decided" && e.item_id === item_id && e.fingerprint === hash);
  return { ...input, item_id, fingerprint: hash, status: decision?.type === "review_decided" ? decision.status : "open" };
}
function referencedFacts(rule: ActionRuleSet | undefined): Set<string> {
  const keys = new Set<string>();
  const walk = (p: Predicate) => {
    if (p.op === "eq" || p.op === "in") keys.add(p.fact);
    else if (p.op === "not") walk(p.rule);
    else p.rules.forEach(walk);
  };
  if (rule?.audience) walk(rule.audience);
  if (rule?.condition) walk(rule.condition);
  return keys;
}
function temporalState(doc: AssistanceDocument, actionId: string): AssistanceCompanion["evaluations"][number]["date_state"] {
  const t = doc.actions.find(a => a.action.id === actionId)?.action.temporal;
  if (!t) return "none";
  if (t.type === "approximate") return "approximate";
  if (t.type === "relative") return "relative";
  if (t.type !== "exact") return "unknown";
  const date = t.date ?? t.datetime?.slice(0, 10);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "unknown";
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) return "unknown";
  if (t.datetime) {
    try { assertTimestamp(t.datetime); } catch { return "unknown"; }
    if (t.date && t.date !== t.datetime.slice(0, 10)) return "unknown";
  }
  return "exact";
}

export function projectAssistance(state: AssistanceState, profiles: LocalProfile[], rules: ActionRuleSet[], now: string): AssistanceCompanion {
  assertState(state);
  assertTimestamp(now);
  requireValue(Array.isArray(profiles) && profiles.length <= ASSISTANCE_LIMITS.profiles && new Set(profiles.map(p => p.profile_id)).size === profiles.length, "INVALID_PROFILE", "Profiles must be bounded and unique");
  for (const p of profiles) { stringValue(p.profile_id, "profile_id"); if (p.scope_key !== undefined) stringValue(p.scope_key, "scope_key"); requireValue(Array.isArray(p.facts) && p.facts.length <= ASSISTANCE_LIMITS.facts, "INPUT_LIMIT", "Local facts exceed limit"); }
  requireValue(Array.isArray(rules) && rules.length <= ASSISTANCE_LIMITS.actions && new Set(rules.map(r => referenceKey(r.action_ref))).size === rules.length, "INVALID_RULE", "Only one rule set per action is allowed");
  const ruleByAction = new Map<string, ActionRuleSet>();
  for (const rule of rules) {
    assertReference(rule.action_ref, true);
    requireValue(["proposed", "user_confirmed"].includes(rule.confirmation), "INVALID_RULE", "Unknown rule confirmation");
    requireValue(Array.isArray(rule.covers_conditions) && rule.covers_conditions.length <= 64 && rule.covers_conditions.every(c => typeof c === "string" && c.length <= 512), "INVALID_RULE", "Invalid condition coverage");
    if (rule.audience) validatePredicate(rule.audience);
    if (rule.condition) validatePredicate(rule.condition);
    assertQuotes(state, rule.quotes, rule.action_ref);
    const target = findAction(state, rule.action_ref);
    requireValue(target && rule.quotes.every(q => q.source_id === rule.action_ref.source_id && q.source_hash === rule.action_ref.source_hash && q.action_id === rule.action_ref.action_id && target.action.evidence.some(e => e.text === q.text)), "EVIDENCE_UNSUPPORTED", "Rule quotes must belong to the target action evidence");
    ruleByAction.set(referenceKey(rule.action_ref), rule);
  }
  const factKeysByAction = new Map([...ruleByAction].map(([key, rule]) => [key, referencedFacts(rule)]));
  const evaluateForProfile = new Map(profiles.map(p => [p.profile_id, createPredicateEvaluator(p.facts, now)]));
  const changes = changeCards(state);
  const workflows = workflowStates(state);
  const pendingRefs = new Set(changes.filter(c => c.status === "open").flatMap(c => [c.before && referenceKey(c.before), c.after.action_id && referenceKey(c.after)].filter((k): k is string => Boolean(k))));
  const openChanges = new Set(changes.filter(c => c.status === "open").map(c => c.change_id));
  for (const event of state.events) if (event.type === "change_proposed" && openChanges.has(event.proposal.change_id)) {
    for (const candidate of [...(event.proposal.target_candidates ?? []), ...changeTargetReferences(state, event.proposal)]) pendingRefs.add(referenceKey(candidate));
  }
  const review_queue: ReviewItem[] = changes.filter(c => c.status === "open").map(c => reviewItem(state, {
    ...(c.before ? { action_ref: c.before } : {}), change_id: c.change_id, field: "revision_link", reason_codes: c.reason_codes,
    question: c.target_resolution === "exact" ? "この通知で、前の予定・提出物を変更してよいですか？" : "どの予定・提出物についての変更か、原本を確認してください。", quotes: c.quotes,
  }, { target_resolution: c.target_resolution }));
  const evaluations: AssistanceCompanion["evaluations"] = [];
  for (const doc of state.documents) for (const stored of doc.actions) {
    const action = stored.action;
    const action_ref: ActionReference = { source_id: doc.source_id, source_hash: doc.source_hash, action_id: action.id };
    const key = referenceKey(action_ref);
    const workflow_state = workflows.get(key) ?? "active";
    const quotes = quotesFor(doc, action.id);
    const date_state = temporalState(doc, action.id);
    if (workflow_state === "active" && stored.trust !== "ready") review_queue.push(reviewItem(state, {
      action_ref, field: "verification", reason_codes: [stored.trust === "blocked" ? "TRUST_BLOCKED" : "TRUST_REVIEW_REQUIRED"], question: "この行動の内容と根拠を確認してください。", quotes,
    }));
    if (workflow_state === "active" && ["event", "attend", "submit", "pay", "sign"].includes(action.kind) && date_state !== "exact") review_queue.push(reviewItem(state, {
      action_ref, field: "temporal.date", reason_codes: ["DATE_UNRESOLVED"], question: "日付は確定していますか？原文にない日付は推測しません。", quotes,
    }, { temporal: action.temporal ?? {} }));
    for (const profile of profiles) {
      const reason_codes: string[] = [];
      let applicability: PredicateResult = { state: "applies", reason_codes: [], missing_facts: [], conflicting_facts: [] };
      if (!profile.scope_key) applicability = { ...applicability, state: "unknown", reason_codes: ["SCOPE_UNKNOWN"], missing_facts: ["scope_key"] };
      else if (profile.scope_key !== doc.scope_key) applicability = { ...applicability, state: "not_applicable", reason_codes: ["SCOPE_MISMATCH"] };
      else {
        const rule = ruleByAction.get(key);
        const rawConditions = action.conditions ?? [];
        const uncovered = rawConditions.filter(c => !rule?.covers_conditions.includes(c));
        if (uncovered.length || (rawConditions.length > 0 && !rule?.condition) || (action.actor.certainty === "explicit" && !rule?.audience)) applicability = { ...applicability, state: "unknown", reason_codes: ["CONDITION_UNMAPPED"] };
        else if (rule && rule.confirmation !== "user_confirmed") applicability = { ...applicability, state: "unknown", reason_codes: ["RULE_UNCONFIRMED"] };
        else if (rule) {
          const predicates = [rule.audience, rule.condition].filter((p): p is NonNullable<typeof p> => Boolean(p));
          if (predicates.length) applicability = evaluateForProfile.get(profile.profile_id)!({ op: "all", rules: predicates });
        }
      }
      if (workflow_state !== "active") reason_codes.push("ACTION_INACTIVE");
      if (stored.trust !== "ready") reason_codes.push(stored.trust === "blocked" ? "TRUST_BLOCKED" : "TRUST_REVIEW_REQUIRED");
      if (pendingRefs.has(key)) { reason_codes.push("CONFIRM_REVISION_LINK"); if (applicability.state !== "not_applicable") applicability = { ...applicability, state: "unknown" }; }
      reason_codes.push(...applicability.reason_codes);
      const ready_for_use = workflow_state === "active" && stored.trust === "ready" && applicability.state === "applies" && !pendingRefs.has(key);
      evaluations.push({ action_ref, profile_id: profile.profile_id, state: applicability.state, reason_codes: [...new Set(reason_codes)], missing_facts: applicability.missing_facts, workflow_state, trust: stored.trust, ready_for_use, ...(applicability.valid_until ? { valid_until: applicability.valid_until } : {}), date_state, calendar_eligible: ready_for_use && date_state === "exact" && ["event", "attend"].includes(action.kind) });
      if (workflow_state === "active" && applicability.state === "unknown" && applicability.reason_codes.length) review_queue.push(reviewItem(state, {
        action_ref, profile_id: profile.profile_id, field: "applicability", reason_codes: applicability.reason_codes,
        question: applicability.missing_facts.length ? `適用条件を確認してください: ${applicability.missing_facts.join("、")}` : "この対象・条件の読み取りを確認してください。", quotes,
      }, { profile_id: profile.profile_id, scope_key: profile.scope_key ?? "", facts: profile.facts.filter(f => factKeysByAction.get(key)?.has(f.key)), rule: ruleByAction.get(key) ?? {} }));
    }
  }
  const uniqueReviews = [...new Map(review_queue.map(item => [item.item_id, item])).values()];
  return { protocol_version: "0.1.0", ledger_id: state.ledger_id, revision: state.revision, changes, review_queue: uniqueReviews, evaluations };
}

export function decideAssistanceReview(state: AssistanceState, item: ReviewItem, status: "resolved" | "dismissed", expectedRevision: number): AssistanceState {
  assertState(state, expectedRevision);
  requireValue(status === "resolved" || status === "dismissed", "INVALID_DECISION", "Unknown review status");
  requireValue(/^review_[a-f0-9]{24}$/.test(item.item_id) && /^[a-f0-9]{64}$/.test(item.fingerprint) && item.item_id === `review_${item.fingerprint.slice(0, 24)}`, "INVALID_REVIEW", "Review identity/fingerprint mismatch");
  // Acknowledgement only. It never changes manifests, source trust, facts or applicability.
  return appendEvent(state, { type: "review_decided", item_id: item.item_id, fingerprint: item.fingerprint, status });
}


/** Public synchronization boundary: changed evaluations/queues advance the ledger revision. */
export function refreshAssistance(state: AssistanceState, profiles: LocalProfile[], rules: ActionRuleSet[], now: string, expectedRevision: number): { state: AssistanceState; companion: AssistanceCompanion } {
  assertState(state, expectedRevision);
  const preview = validateAssistanceCompanion(projectAssistance(state, profiles, rules, now));
  const content = fingerprint({ ...preview, revision: 0 });
  const previous = [...state.events].reverse().find(e => e.type === "projection_refreshed");
  if (previous?.type === "projection_refreshed" && previous.fingerprint === content) return { state: structuredClone(state), companion: preview };
  const next = appendEvent(state, { type: "projection_refreshed", fingerprint: content });
  return { state: next, companion: { ...preview, revision: next.revision } };
}
