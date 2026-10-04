# Final self-review — Matoe compatibility

Reviewed the full local diff from
`18c159c0bbb238b410c003cc8e60e7a8e013309f`, plus the actual Otayori Swift contract
read through connected GitHub at `696b2ebb21e28dbf6ba56cfce68c29f6df1480b9`.
Contract blob: `f10b8cb8c66034280c06718833d1ed609c0a53cc`.
This checkout has no local `main` ref; use the explicit base SHA for diff review.

## Findings and corrections

| Area | Actual Swift behavior / evidence | Judgment and correction |
| --- | --- | --- |
| Wire correspondence | [shape validation](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L305), receipt validation | Golden wire matches allowed keys and version; source/actions remain equal to the original. Only the explicitly audited version rewrite and v0.2-only verification projection change the wire. Full provenance stays in audit. |
| False verified positives | [hash and fatal checks](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L465), [ingress policy](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L496) | Converter recomputes exact OCR hash, checks source quotes, demands every aggregate/per-action flag and complete consistent counts, rejects failures/mixed results, and never promotes status. Verified without receipt and approval/export/rejection states fail. Self-reported receipts still are not cryptographic proof; actual extraction→verification is separately tested through built packages. |
| Confirmation flags | [verification review requirement](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L237), [needsUserConfirmation predicate](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L645) | Swift derives the flag; the frozen wire has no needsUserConfirmation field. Missing verification, missing/low confidence, low component confidence, inferred/proposed status, non-explicit actor, uncertain/missing dates, and ambiguous kind/modality inputs remain unchanged. Nine field-preservation matrix cases cover those inputs without pretending to execute Swift. |
| Warnings / ignored conditions | Swift hasSoftFailure at L165 only treats error severity as failure; mapAction at L627 does not display issue messages, conditions, or notes | **Initial implementation gap fixed:** a warning could say "review" yet neither display nor request confirmation. All verification issues/warnings now fail this profile. Nonempty conditions and any notes also fail; no flag is fabricated and no information is silently removed. |
| Date / timezone | [day mapping](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L724), [parseDateOnly](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L863) uses `.autoupdatingCurrent` at L872 | **Initial implementation gap fixed:** explicit timezone was retained in wire but ignored in the domain mapping. Any explicit timezone now fails. Clock-time, ranges, alternatives and unsupported deadline qualifiers already fail. Date-only output means the client's local civil date, not a globally fixed instant. Device/DST/UI behavior still needs Swift testing. |
| Timestamp grammar | [strictDateTimeParts](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L911) requires uppercase T/Z and seconds 00..59 | **Schema-only mismatch fixed:** lowercase/space-separated receipt times and leap seconds can pass AJV but fail Swift. Additional strict timestamp checks now reject them; regression cases demonstrate this distinction. |
| Actor and multiple Evidence | [mapAction](https://github.com/hello-ai-company/Otayori/blob/696b2ebb21e28dbf6ba56cfce68c29f6df1480b9/Otayori/Services/Analysis/ActionManifestContract.swift#L640) selects only the first Evidence and omits actor identity | Multiple quotes now fail. Actor role fails; actor text must occur in the one visible quote. Golden quote includes its actor text. Source IDs, URI, bbox and section are provenance retained in wire/audit; the app does not display every provenance field. No complete UI representation is claimed. |
| Huge/unknown input | Frozen schemas reject additional fields/null at every object; initial CLI used unbounded readFile | **Bound added:** CLI reads regular files up to 1 MiB manifest / 240,000 OCR bytes before JSON parsing, validates UTF-8 without replacing bytes, and checks file growth. API also limits OCR to 60,000 scalars and has a string/key budget and depth 24. Unknown fields and recursive/cyclic input are subject to limits. These are request limits, not a whole-service memory or concurrency guarantee. |
| CLI data disclosure | Initial command implicitly printed the audit/original bundle and generic JSON errors could echo input | **Output made explicit:** exactly one of --out or --json is required. File output uses wx + mode 0600. Failures emit no bundle and suppress parser/schema/file input details, including unknown version strings and action IDs. Synthetic private markers test stderr suppression. Explicit bundle output intentionally includes supplied Evidence/original fields; no secret detection/redaction is promised, and no environment credentials or standalone OCR text are appended. |

The actual deterministic extractor emits `actor.role=guardian` for source.txt,
and the stricter review correctly found that this is outside the initial
profile. A built-package regression explicitly asserts that the verified
extractor output is refused, rather than stripping the role or claiming a
successful bridge. The documented successful extractor pipeline now uses the
separate plain-source.txt fixture, with unknown actor and therefore required
Matoe confirmation. The original golden wire/source fixture is unchanged.

During review verification, an unchecked Evidence array access failed TypeScript
and one rejection test observed the actor check before the source-quote check.
Both were corrected with an explicit visible-quote guard and source validation
first. The first complete review integration run exposed the real role boundary
above; it is now covered by its own negative regression alongside the successful
role-free pipeline. Final results, rather than these intermediate failures,
determine the gate.

## Review scope and limits

The comparison above is against actual source implementation, not merely the
0.1 JSON type. Golden/field-preservation/refusal tests check the TypeScript
projection; built-package tests exercise the local extraction and CLI boundary.
No surrogate Swift implementation or copied needsUserConfirmation predicate was
used as purported end-to-end proof.

Receipt verification, provenance, and approval checks were not weakened.
Unknown schema dispatch remains fixed by own-property lookup. No default 0.2
output, frozen schema, normative conformance vector, engine requirement, product
identity model, remote repository, deployment, or production configuration changed.

Remaining connection work: run the golden wire and exact OCR through the real
Swift decoder, assert UI due date and confirmation behavior (including local
timezone/DST), then test a local free HTTP stub and audit retention. Active
backend and Release URL overrides remain unknown. Actual payments/replies are
outside this conversion and were not performed.

Final measured checks are recorded in [GATES.md](GATES.md).
