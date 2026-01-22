/**
 * Plan Progress Reader
 *
 * Read-only module for parsing tasks.md progress.
 * This is the "File is Source of Truth" implementation.
 */

export { readPlanProgress } from "./reader"
export type { PlanProgressDetail, CheckboxInfo, CheckboxStatus, CheckboxPriority } from "./reader"
