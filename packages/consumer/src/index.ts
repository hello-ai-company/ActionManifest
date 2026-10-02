export { manifestFatalReasons } from "@actionmanifest/core";
export { CONSUMABLE_STATUSES, classifyManifest, readyActions } from "./classify.js";
export type {
  ActionDisposition,
  ConsumableAction,
  ConsumerReport,
  DispositionReason,
} from "./classify.js";
export { prepareMatoeManifest } from "./matoe.js";
export type { MatoeCompatibilityBundle } from "./matoe.js";
