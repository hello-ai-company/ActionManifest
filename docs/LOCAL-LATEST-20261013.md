# Latest source on MacBook Air

Verified v8 source archive SHA256: `7cb1a2baf4bee5b3224b7834a89efa0730ea032d712dc61bc7d26b59666696da`.
Verified freshness prototype SHA256: `c0f01edcefad8900277786bf8681dee36a22bae9839db018e31e8d5fa833ccdb`.

The v8 family review and earlier bundled document-query/consumer changes are included. The freshness implementation now lives in `packages/core/src/evidence-freshness.ts` and is exported from `@actionmanifest/core`. Pass exact canonical text snapshots and pinned quotes to `pinEvidence`, `checkEvidenceFreshness`, or the cancellable async variant. Freshness is an additional gate; it does not grant execution or replace action verification. Missing sources and explicit deletion remain distinct; duplicate source IDs fail closed.

On Node 22.14.0 and pnpm 11.23.0: build, typecheck, lint, 1031 unit tests, 104 integration tests, and schema validation passed on this Mac. The built CLI starts with `node apps/cli/dist/index.js --help`. No publishing or deployment occurred.

Reproduce: `corepack pnpm install --frozen-lockfile --ignore-scripts`, `corepack pnpm build`, `corepack pnpm typecheck`, `corepack pnpm lint`, `corepack pnpm test`, `corepack pnpm integration:test`, `node --import tsx scripts/validate-schema.ts`.
