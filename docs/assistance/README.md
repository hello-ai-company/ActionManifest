# Assistance companion: local candidate APIs

This bounded milestone adds cross-document revision history, source-backed review
queues and local three-valued audience/condition evaluation to the reusable consumer
package. It does not change either frozen Manifest schema. It does not send alerts,
create network services, infer a child's private attributes, or make household decisions.

## Minimal lifecycle

1. `createAssistanceState(ledgerId)` creates one local revision stream.
2. `registerAssistanceDocument(state, manifest, canonicalText, sourceId, scopeKey,
   bindings, expectedRevision)` runs the existing strict v0.2 ingress, binds SHA-256
   to the exact redacted source text and derives trust from the receipt. Binding
   subject keys are explicitly supplied local identities, never title similarities.
3. `suggestDocumentChanges` returns reviewable same-scope, exact-binding candidates.
   `proposeAssistanceChange` records a caller-supplied correction, cancellation or
   unresolved possible change with original-source quotes. Cancellation notices may
   contain zero active actions. Missing bindings remain unresolved; multiple active
   targets remain ambiguous. No action is removed or marked completed.
4. `refreshAssistance(state, localProfiles, reviewedRules, now, expectedRevision)`
   returns `{state, companion}`. Persist the returned state before distributing its
   companion. An output change, including expired/changed local facts, advances the
   same ledger revision. The companion is defined in `companion-v0.1.md`.
5. `decideAssistanceChange` requires an explicit recorded user confirmation and the
   current revision. Applying an exact correction marks the original superseded;
   cancellation marks it cancelled. Both original snapshots remain. `reopen` is Undo;
   accepted descendants must be undone first. These are local lifecycle changes,
   not an instruction to create calendar entries or deliver notifications.
6. `decideAssistanceReview` acknowledges a precise fingerprint. It cannot override
   verification, applicability or date precision. Material changes to that question's
   source, relevant facts or rule create a new question; unrelated fact edits do not.
7. `restoreAssistanceState(JSON.stringify(state))` revalidates all manifests through
   the real frozen-schema gate, recomputes stored trust and replays the history. Do
   not deserialize untrusted JSON by casting it to `AssistanceState`. Ordinary API
   state parameters are trusted in-process state; this API is not a signed audit log.

## Conditions, expiry and privacy

Rules are bounded declarative `eq`, `in`, `all`, `any`, `not` predicates. Proposed
rules never establish applicability. Each reviewed condition mapping must preserve
its exact source condition and target-action quotes. Explicit unstructured audiences
and uncovered conditions remain unknown. Missing, expired or contradictory facts do
not silently become false or true. Logical conditions ask only about unknown values
that can still affect the result. Fact values remain local and do not appear in the
companion; the application owns consent, storage and friendly question labels.

A cached evaluation must not be used at or after `valid_until`, or after any relevant
fact/rule/source changes. This bound is the earliest expiry of referenced current
facts. An indefinite fact requires an explicit local value without an expiry; the
API never invents or extends an expiry. A scope mismatch is not applicable; missing
scope is unknown. IDs are opaque; the consumer defines its local child/member mapping.

## Consumer application gate

`ready_for_use` means active, receipt-ready, applicable and without a pending change.
It is not automatic permission to schedule, notify or share. A pending exact change
holds both sides; ambiguous changes hold every referenced target candidate.

To avoid a confirmation loop, an application may apply the specific exact change
that the person is confirming when its replacement is active + trust ready, has no
missing facts, and the only unknown reason is `CONFIRM_REVISION_LINK`. Every other
reason, expired `valid_until`, stale binding/revision or missing original must block
that exception. A resolved remote/local snapshot still needs explicit local binding
and user confirmation before changing an application's items. Undo must retain prior
item snapshots and reject concurrent conflicting edits.

`calendar_eligible` is an exact-date planning hint for event/attend actions, not timed
conflict authority. Date-only, unknown end times and approximate/relative/conditional
values must not become timed appointments. No invented `isAllDay=false` or end time
is emitted. Conflicting date/datetime values stay out of firm calendar candidates.

## Coverage and bounds

Coverage is **registered inputs only**. The API cannot know about unread notices,
failed uploads, unreadable OCR pages or sources that were never supplied. The app
must display intake/retry/coverage separately; an empty queue does not prove that
nothing is outstanding. No real family or school data is included in the fixtures.

Bounds: 64 documents, 2,048 actions, 4,096 history events, 16 local profiles, 128 facts
per profile, predicate depth 8 and 64 nodes, 256 KiB per source, 2 MiB total source
text. Exceeding a bound fails closed; history is never silently dropped. Persistent
JSON is capped at 8 MiB. Generated companions also pass the strict wire/output
complexity budget before public refresh returns; combined inputs may hit that
output limit earlier than an individual input maximum. Explicit archival/rotation is a future application policy.

## Verification status

Pure consumer and inherited extraction-safety tests run with reused Vitest 4.1.10,
not pinned 4.1.11. Source-only fixture generator and predicate microbenchmark are in
`packages/consumer/test/`. The generated open/resolved/undo samples exercise the
actual pure projection and strict companion validator from synthetic internal
snapshots. They do not bypass, replace or certify the production ingress.

Production ingress/replay tests require actual AJV/AJV-formats and are currently
blocked before collection. Full workspace typecheck also lacks AJV, Xberg and
Commander. Swift/device and combined app runtime tests are separate gates. This is
an unpublished candidate; full gates and production readiness remain unestablished.
