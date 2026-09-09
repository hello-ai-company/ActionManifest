# Adversarial Document Reliability Benchmark (Phase 1.2)

The goal of this benchmark is **not** to extract more Actions. It is to
systematically find cases where Action Manifest produces a **plausible but wrong
Action and marks it `verified`**. For a trust layer that downstream apps
(Otayori and others) rely on, a wrongly-verified Action is far more dangerous
than a missed one.

## Integrity guard (normative)

> **Expected truth is normative. Extractor output is not the oracle.**

Each fixture's `expected.json` is **human-authored semantic truth**, written
*before* comparing to the extractor. You MUST NOT edit `expected.json` to match
what the extractor currently emits. If the extractor disagrees with the expected
truth, that is a finding — fix the extractor (minimally) or record it as a
tracked gap; never “fix” the test by rewriting the truth.

Evaluation flow:

```
Document
  → Human-authored expected truth (active actions + must_not_extract)
  → Extractor (deterministic)
  → Verifier (per-action)
  → Diff / metrics (esp. False Verified Action Rate)
```

## Fixture contract (benchmark-only)

`benchmark/fixtures/<lang>/<id>/` holds `input.txt`, `meta.json`, `expected.json`.
`expected.json` uses a **benchmark-only** shape — it MUST NOT be added to the
production Action Manifest schema:

```jsonc
{
  "actions": [ /* the semantically-correct ACTIVE actions */ ],
  "must_not_extract": [
    {
      "date": "2026-10-15",          // matches primary date OR an alternative
      "primaryDate": "2026-10-19",   // matches ONLY the primary date
      "kind": "event",
      "modality": "required",
      "object": "…", "titleIncludes": "…",
      "unconditionalRequired": true, // a required action with no conditions
      "failure": "SUPERSEDED_DATE",  // taxonomy code below
      "severity": "critical",        // critical | high | medium
      "reason": "why this is wrong"
    }
  ]
}
```

`meta.json` tags adversarial fixtures with `"adversarial"` and marks the
Adversarial Golden Set with `"adversarialGolden": true`.

## Fatal (manifest-level) vs per-Action — unchanged from Phase 1.1

Source-hash mismatch, empty document, and schema-invalid manifests remain
manifest-level fatal (nothing is verified). Everything the adversarial corpus
targets is a **per-Action** trust failure: a single wrong Action must fail on its
own without invalidating the valid Actions beside it.

## Failure taxonomy (internal)

`HALLUCINATED_ACTION`, `STALE_ACTION`, `SUPERSEDED_DATE`, `NEGATION_LOST`,
`CONDITION_LOST`, `WRONG_MODALITY`, `WRONG_ACTOR`, `WRONG_TEMPORAL`,
`CROSS_ACTION_CONTAMINATION`, `DUPLICATE_ACTION`, `WRONG_EVIDENCE`,
`REFERENCE_MISREAD_AS_ACTION`, `AMBIGUITY_COLLAPSED`. These are benchmark codes
only; they are never emitted into a production manifest.

## Severity

- **critical** — a wrong Action that got **verified**: a superseded/old deadline,
  a cancelled event, a reference/quoted date, or a prohibited/negated action
  turned required-and-verified. CI fails on any critical false-verified.
- **high** — wrong actor, lost condition, stale (past) action, silently
  normalized OCR date, cross-action contamination.
- **medium** — duplicates, title mismatches.

## Metrics

Existing: Action Precision/Recall, Deadline/Actor/Modality Accuracy, Evidence
Match, Hallucination Rate, Ambiguity Preservation, Action Verification Rate.

Phase 1.2 adds:

- **False Verified Action Rate** (the safety metric): forbidden Actions that were
  verified / forbidden Actions extracted. Lower is better; critical instances
  must be zero.
- **Forbidden Action Rate**, **Stale Action Rate**, **Duplicate Action Rate**
  (lower is better).
- **Correction Resolution Accuracy**, **Negation Preservation**, **Conditional
  Preservation** (higher is better).

There is intentionally **no single blended score**.

## Trust order (priority)

```
False verified action prevention
  > Evidence correctness
  > Negation / correction / condition preservation
  > Ambiguity preservation
  > Recall
  > Feature count
```

A low Recall on an adversarial fixture is acceptable when the alternative would
be a confident-wrong Action; that is the trust order working as intended.

## Adversarial Golden Set + CI gate

A 10-fixture Adversarial Golden Set (`adversarialGolden: true`) runs in CI smoke
alongside the original Golden Fixture. CI enforces:

- Golden Fixture PASS
- Adversarial Golden PASS
- **Critical false-verified = 0** (across the full suite via `pnpm benchmark`)
- Schema validation PASS

## Stateful adversarial cases (must not rely on position)

A trust layer must never verify an Action from a positional heuristic
("the later date is the new one", "the last Action is the target"). Three
stateful cases are covered explicitly:

- **Correction / extension target** — the active date is the **replacement
  target**, never the chronological maximum and never "the first date because no
  cue matched". The resolver drops the date explicitly marked as superseded
  (`Xの予定`, `Xに予定していた`, `Xとしていました`, `Xから`, `changed from X`,
  `was X`) and keeps the remaining one, so it handles forward, reverse, from→to
  (`XからYに変更` / `changed from X to Y`) and gerund (`…変更し、Yに実施します`)
  forms. If the target cannot be resolved uniquely, the date is omitted rather
  than verified.
- **Cross-sentence cancellation** — a cancellation in a later sentence deactivates
  the matching Action created earlier (by event/subject/object), while unrelated
  Actions in the same document are preserved.
- **Negation / exemption target** — a blanket negation attaches to the Action it
  names (by object/title identity), never to the last Action by position; an
  eligibility / prior-submission exemption still narrows its own submit. If no
  target is identifiable, the requirement is not resurrected and no unrelated
  Action is contaminated. Target identity uses a small **canonical resolver**
  (lowercase, strip punctuation, leading imperative verbs like `please submit` /
  `bring`, and determiners `the`/`a`/`an`) so `Please submit the permission form`,
  `The permission form` and `permission form` resolve to the same target in
  English. No stemming / NLP dependency.

Benchmark-only failure codes `WRONG_NEGATION_TARGET` and
`WRONG_CANCELLATION_TARGET` name the position-heuristic mistakes. The rule is
always: **cannot identify the target safely → omission / unverified**, never
**probably this → verified**.

## Adding an adversarial fixture

1. Author `input.txt` (synthetic, no PII).
2. Write `expected.json` semantic truth **first**, plus `must_not_extract`.
3. Run `pnpm benchmark`; if a critical false-verified appears, fix the
   extractor/verifier **minimally** — do not rewrite the expected truth.
4. Keep the Golden Fixture and existing metrics from regressing.
