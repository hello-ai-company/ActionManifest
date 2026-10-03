export { manifestFatalReasons } from "@actionmanifest/core";
export { CONSUMABLE_STATUSES, classifyManifest, readyActions } from "./classify.js";
export type {
  ActionDisposition,
  ConsumableAction,
  ConsumerReport,
  DispositionReason,
} from "./classify.js";
export { MATOE_INPUT_LIMITS, prepareMatoeManifest } from "./matoe.js";
export type { MatoeCompatibilityBundle } from "./matoe.js";
export { prepareMatoeV02Manifest } from "./matoe-v02.js";
