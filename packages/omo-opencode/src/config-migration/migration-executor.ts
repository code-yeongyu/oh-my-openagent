import { dirname, posix } from "node:path"

import {
  DEFAULT_MIGRATION_FILE_SYSTEM,
  runMigration,
  type MigrationFileSystem,
  type MigrationRunResult,
  type RunMigrationOptions,
} from "@oh-my-opencode/omo-config-core"

import type { LegacyConfigMigrationPlan } from "./migration-plans"

export type ExecuteLegacyConfigMigrationPlanOptions = Omit<
  RunMigrationOptions,
  "id" | "sources" | "targetPath" | "transform"
>

function directoryPath(path: string): string {
  return path.startsWith("/") ? posix.dirname(path) : dirname(path)
}

function createBackupDirectories(
  plan: LegacyConfigMigrationPlan,
  fileSystem: MigrationFileSystem,
): void {
  for (const source of plan.sources) {
    if (source.backupPath === undefined) continue
    fileSystem.mkdirSync(directoryPath(source.backupPath), { recursive: true })
  }
}

export function executeLegacyConfigMigrationPlan(
  plan: LegacyConfigMigrationPlan,
  options: ExecuteLegacyConfigMigrationPlanOptions = {},
): MigrationRunResult {
  const fileSystem = options.fileSystem ?? DEFAULT_MIGRATION_FILE_SYSTEM
  createBackupDirectories(plan, fileSystem)
  return runMigration({ ...options, fileSystem, ...plan })
}
