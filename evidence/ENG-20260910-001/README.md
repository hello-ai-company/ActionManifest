# Evidence path — ENG-20260910-001 (Phase 2.3)

**Eng ops fills this directory.** Agents never write evidence content here —
this placeholder only records the gate rule.

**Meeting Round-2 (locked, 2026-09-10):** the evidence/completion gate ⑤
must be satisfied **BEFORE any merge recommendation** — not after review,
not after merge. The pull request stays **DRAFT** until every gate,
including evidence completion, is GREEN.

Do not put real documents, customer names, email fragments, secrets, or
internal memos here. The public repo may only contain OSS-safe notes. See
[docs/PUBLIC-BOUNDARY.md](../../docs/PUBLIC-BOUNDARY.md) and
[docs/ENG-20260909-001.md](../../docs/ENG-20260909-001.md).

Machine-checkable release evidence for this phase is the CI artifact
`release-check-<sha>` (tarballs, SHA256SUMS, release manifest, SBOM) from
the Release Check workflow — see
[docs/RELEASING.md](../../docs/RELEASING.md) §3.
