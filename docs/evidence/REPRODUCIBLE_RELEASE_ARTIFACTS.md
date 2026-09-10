# Reproducible Release Artifacts — Defect Evidence (Phase 2.4A.1)

## Incident

Independent comparison of Release Check artifacts found that tarballs
generated from the SAME git tree were NOT byte-identical.

Observed SHA-256 divergence (before the fix):

| Source | @actionmanifest/extractor | @actionmanifest/cli |
| --- | --- | --- |
| PR Release Check artifact | `ef2478af2431…` | `b747525e615c…` |
| post-merge main Release Check artifact | `67a75e787205…` | `da2493e54bac…` |
| maintainer local bootstrap artifact | `ef2478af2431…` | `fdd51fb41b59…` |

## Root cause

pnpm ≤ 10.x packs workspace manifests with **unstable dependency key
ordering** (upstream: pnpm/pnpm#10167). The `workspace:*` → release-version
rewrite produces the same semantic content but a different JSON key
insertion order per run, changing tarball bytes and therefore SHA-256.

## Isolated reproduction (pnpm 10.14.0, clean checkout @ 5a13b6f)

Five independent `pnpm pack` runs of `@actionmanifest/cli` from the same
clean tree produced five DIFFERENT SHA-256 hashes:

```
run-1 ce6f5b74296589f5e782f773aff1e78ed28acfcb76fd0ad8e74b83cfe468bd18
run-2 99650c00a14b522521b790f936b2e30128009e25bc0405c47e28c9d304edd53a
run-3 fe86d667269f40c47d438ad6461e39cc7fc8c5184caca1d3cbdf1e64a313a1ca
run-4 d2efeb7c6a08948141989a2275882d92599d41ce8a9bb61ce9af41d937e8b5a4
run-5 5a44d028759464b1741012ec43e3ae229f2a5a8be85d99c51912f47bfc518e5e
```

(`@actionmanifest/extractor` happened to be stable in this local run — the
ordering instability is nondeterministic — but diverged between CI runs, per
the incident table above.)

Tarball file lists were identical (334 entries each); only
`package/package.json` dependency key order differed, e.g.:

```diff
run-1 vs run-2 (packed package/package.json, dependencies only):
+    "@actionmanifest/adapters": "0.9.0-rc.0",
     "@actionmanifest/consumer": "0.9.0-rc.0",
-    "@actionmanifest/exporters": "0.9.0-rc.0",
     "@actionmanifest/core": "0.9.0-rc.0",
-    "@actionmanifest/verifier": "0.9.0-rc.0",
-    "@actionmanifest/adapters": "0.9.0-rc.0"
+    "@actionmanifest/exporters": "0.9.0-rc.0",
+    "@actionmanifest/verifier": "0.9.0-rc.0"
```

## Fix

- `packageManager` pinned to `pnpm@11.23.0` (contains upstream fix for
  #10167: "Packed workspace package manifests now preserve dependency
  order, making repeated pnpm pack output deterministic").
- New gate: `pnpm release:reproducibility` — 10 independent packs × 10
  public packages, all hashes MUST be identical per package; on mismatch the
  packed `package/package.json` is extracted and diffed as a diagnostic
  (never canonicalized — tarball BYTES must match).

Evidence after the fix is appended below by the phase 2.4A.1 change.

## After the fix (pnpm 11.23.0, same clean tree)

Ten independent `pnpm pack` runs × 10 public packages — all byte-identical:

```
@actionmanifest/schema       10/10 identical
@actionmanifest/core         10/10 identical
@actionmanifest/temporal     10/10 identical
@actionmanifest/adapters     10/10 identical
@actionmanifest/extractor    10/10 identical
@actionmanifest/verifier     10/10 identical
@actionmanifest/exporters    10/10 identical
@actionmanifest/consumer     10/10 identical
@actionmanifest/adapter-xberg 10/10 identical
@actionmanifest/cli          10/10 identical

REPRODUCIBLE — 10 packages × 10 runs, byte-identical per package (pnpm 11.23.0)
```

All artifact sets generated before this fix (PR artifacts, old main
artifacts, local bootstrap artifacts) are OBSOLETE and must never be
published.

## New gates

- `pnpm release:reproducibility` — 10 independent packs × 10 packages, all
  hashes identical per package; refuses to run on pnpm < 11.23.0; on
  mismatch, extracts and diffs the packed `package/package.json` as a
  diagnostic (never a semantic/canonicalized hash).
- `release:check` (full) runs the 10×10 gate; `release:check:quick` (PR)
  runs 2×10.
- `pnpm bootstrap:check --publish-ready` additionally downloads the
  exact-head Release Check artifact and requires the local tarball set to be
  byte-identical (10/10 SHA-256 match) — local rebuilt artifacts that differ
  from the reviewed CI artifacts are BLOCKED from publication.
