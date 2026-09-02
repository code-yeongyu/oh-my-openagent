import type { UlwLoopPlan } from "./types.js";
/**
 * `status --json` is the one call every agent already makes between steps, so it is
 * also the cheapest place to answer "what now?" without a second round trip.
 */
export declare function statusNextActions(plan: UlwLoopPlan): readonly string[];
