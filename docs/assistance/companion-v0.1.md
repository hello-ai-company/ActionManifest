# ActionManifest Assistance Companion 0.1.0 (candidate contract)

Separate JSON envelope; ActionManifest schemas 0.1/0.2 remain unchanged.
All optional fields are omitted, never null. Unknown protocol versions/enums and
null values are rejected. JSON has no executable expressions. IDs are opaque strings.
`source_hash` is SHA-256 of the exact canonical redacted OCR, not the attachment hash.

Envelope: `protocol_version: "0.1.0"`, `ledger_id` (stable opaque local ledger ID), `revision` (nonnegative integer),
`changes`, `review_queue`, `evaluations` (arrays, present even when empty).

## Changes

- `change_id`: stable string
- `kind`: `corrects | cancels | possible_change`
- `before`: optional `{source_id, source_hash, action_id}`
- `after`: `{source_id, source_hash, action_id?}`; cancellation source may have no action
- `quotes`: `[{source_id, source_hash, action_id?, text, page?, bbox?, section?, source_reference?}]`
- `changed_fields`: `[{field, before_value?, after_value?}]`; values are strings
  copied/rendered from existing actions, not invented. Supported fields are
  `title`, `object`, `modality`, `temporal.date`, `temporal.datetime`, `conditions`.
- `reason_codes`: strings
- `target_resolution`: `exact | ambiguous | unresolved`
- `status`: `open | resolved | dismissed`

Only an explicit exact source/action binding plus a recorded user confirmation
can apply a revision. Similar titles alone never identify a target. Unresolved
local-to-AM mappings remain `possible_change` / `unresolved`; consumers must not
silently delete, complete, reschedule or change notification settings.
Applied changes retain original documents/actions and append decision history.

## Review queue

`item_id`, `fingerprint`, optional `action_ref`, `change_id`, `profile_id`, `field`,
`reason_codes`, `question`, `quotes`, `status` (`open | resolved | dismissed`).
A changed source/hash, reason, rule or fact creates a new fingerprint. Resolving
or dismissing a queue card is an acknowledgement, not a trust or applicability override.

## Evaluations

`action_ref`, `profile_id` (opaque local ID), `state`
(`applies | not_applicable | unknown`), `reason_codes`, `missing_facts`,
`workflow_state` (`active | superseded | cancelled`), `trust`
(`ready | review_required | blocked`), `ready_for_use` (boolean),
`date_state` (`exact | approximate | relative | unknown | none`),
`calendar_eligible` (boolean), optional `valid_until` (ISO8601 timestamp).
At or after `valid_until`, consumers must re-evaluate and must not apply cached
readiness. It is the earliest expiry of any current fact referenced by the rule,
including conflicting facts. Only unbounded or absent relevant current facts
omit it; omitted validity is not authentication or a general cache guarantee.
Facts edited before that instant also require re-evaluation. Calendar eligibility additionally requires a
verified active event/attend Action with an explicit exact date/datetime.
Approximate/relative/conditional dates are not promoted into firm appointments.
Only active + ready + applies is ready_for_use. Missing/stale/conflicting facts
or uncovered source conditions remain unknown. Facts stay local; no outbound
HTTP, notifications, child/health-data transmission, or automated user decisions.

Reason codes may include TRUST_BLOCKED, TRUST_REVIEW_REQUIRED, DATE_UNRESOLVED,
CONDITION_UNMAPPED, RULE_UNCONFIRMED, FACT_MISSING, FACT_EXPIRED, FACT_CONFLICT,
SCOPE_MISMATCH, SCOPE_UNKNOWN, TARGET_UNRESOLVED, TARGET_AMBIGUOUS,
CONFIRM_REVISION_LINK, REVISION_APPLIED, REVISION_DISMISSED, ACTION_INACTIVE.
Consumers display unknown reason strings generically and never promote trust from them.


## Synchronization identity

Compare snapshots only within the same ledger_id. Reject older revisions and
same-revision/different-payload responses. A different ledger requires explicit
local selection/reset, never silent replacement. The public refreshAssistance
API records a snapshot event when fact/rule evaluation changes the output, so
such changes also advance revision. Acknowledgements do not grant action trust.
Calendar eligibility is a date-precision planning hint, not timed-conflict
authority: date-only values remain all-day/unspecified-time data.

## Cross-record consistency

Open changes hold referenced before/after actions: no applies/ready/calendar use.
An exact correction requires before and after action IDs. An applied correction's
predecessor is superseded; an applied cancellation's target is cancelled. Those
evaluations cannot remain active/ready. Consumers reject contradictory payloads,
duplicate applied predecessors and missing new-source quotes. Such consistency
checks do not authenticate an issuer or establish facts omitted from the snapshot.
