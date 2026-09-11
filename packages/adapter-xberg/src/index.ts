/**
 * @actionmanifest/adapter-xberg — Xberg reference adapter (optional package).
 *
 * Stability split (0.x line):
 * - Layer A `mapXbergResultToCanonical` — stable structural mapper (pure;
 *   no native binding, no network). Normal 0.x policy.
 * - Layer B `XbergAdapter` runtime bridge — `@experimental` (dynamic import
 *   of the NAPI binding; verified against @xberg-io/xberg exactly 1.1.3;
 *   Node >= 22; Release Check gates a native smoke on the canonical
 *   tarball; local opt-in is `pnpm xberg:integration`).
 */
export { XbergAdapter } from "./adapter.js";
export {
  XBERG_ADAPTER_VERSION,
  mapXbergResultToCanonical,
} from "./mapper.js";
export type { XbergMapOptions } from "./mapper.js";
export type {
  XbergAdapterInput,
  XbergBytesInput,
  XbergResultInput,
  XbergUriInput,
} from "./types.js";
