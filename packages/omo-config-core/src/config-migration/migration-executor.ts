import {
  runMigration,
  type MigrationRunResult,
  type RunMigrationOptions,
} from "../migration"

import type { LegacyConfigMigrationPlan } from "./migration-plans"

export type ExecuteLegacyConfigMigrationPlanOptions = Omit<
  RunMigrationOptions,
  "id" | "sources" | "targetPath" | "transform"
>

export function executeLegacyConfigMigrationPlan(
  plan: LegacyConfigMigrationPlan,
  options: ExecuteLegacyConfigMigrationPlanOptions = {},
): MigrationRunResult {
  return runMigration({ ...options, ...plan })
}
