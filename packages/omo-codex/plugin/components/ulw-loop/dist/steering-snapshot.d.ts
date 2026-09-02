import type { UlwLoopPlan } from "./domain-types.js";
import type { UlwLoopSteeringPlanSnapshot } from "./steering-types.js";
/**
 * Compact before/after snapshots for steering ledger entries.
 *
 * Ledger entries used to embed the FULL plan (every goal, criterion, and
 * evidence string) twice per audit and twice more at the entry top level.
 * That made each accepted steer O(plan size) on disk, so the ledger grew
 * quadratically over a run, and every dedup scan re-hydrated all of it into
 * memory. A snapshot instead records plan-level counters plus only the goals
 * the mutation actually touched, keeping each entry O(changed goals).
 */
export declare function buildSteeringPlanSnapshot(plan: UlwLoopPlan, changedGoalIds: ReadonlySet<string>): UlwLoopSteeringPlanSnapshot;
/** Ids of goals that differ between two plans, including added or removed goals. */
export declare function changedGoalIdsBetween(before: UlwLoopPlan, after: UlwLoopPlan): Set<string>;
