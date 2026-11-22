import { posix } from "node:path"

import {
  runMigrations,
  type MigrationBoundary,
  type MigrationClock,
  type MigrationEnvironment,
  type MigrationFileSystem,
  type MigrationRunResult,
} from "@oh-my-opencode/omo-config-core"

import {
  createLegacyConfigMigrationPlans,
  type ConfigMigrationDiscoveryFileSystem,
  type ConfigMigrationPathOperations,
} from "./config-migration"

export type OpenCodeStartupMigrationOptions = {
  readonly afterMigrations?: (results: readonly MigrationRunResult[]) => void
  readonly backupTimestamp?: string
  readonly clock?: MigrationClock
  readonly cwd: string
  readonly discoveryFileSystem?: ConfigMigrationDiscoveryFileSystem
  readonly dryRun?: boolean
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly env?: MigrationEnvironment
  readonly fileSystem?: MigrationFileSystem
  readonly homeDir?: string
  readonly isProcessAlive?: (pid: number) => boolean
  readonly onBoundary?: (boundary: MigrationBoundary) => void
  readonly pathOperations?: ConfigMigrationPathOperations
  readonly pid?: number
  readonly platform?: NodeJS.Platform
}

export type OpenCodeStartupMigrationResult = {
  readonly error?: string
  readonly journalResumed: boolean
  /** Where each migrated legacy source was backed up, so dropped keys can point somewhere. */
  readonly legacyBackupPaths: readonly string[]
  readonly migratedFrom: readonly string[]
  /** Legacy top-level keys the transform could not map into the unified config (#10957). */
  readonly notImportedKeys: readonly string[]
  readonly reloadRequired: boolean
  readonly results: readonly MigrationRunResult[]
  readonly skippedConflictCount: number
  /** Every pre-write copy of an existing target this run kept, including one a resumed journal kept. */
  readonly targetBackupPaths: readonly string[]
  readonly resumedTargetBackupPath?: string
}

function homeDirectory(options: OpenCodeStartupMigrationOptions): string {
  const environment = options.environment ?? process.env
  return options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"] ?? ""
}

function uniqueSources(results: readonly MigrationRunResult[]): readonly string[] {
  return [
    ...new Set(
      results.flatMap((result) =>
        result.status === "migrated" ? (result.preview?.backupMoves.map((move) => move.from) ?? []) : [],
      ),
    ),
  ].sort()
}

const NOT_IMPORTED_PREFIX = "not imported: "

function notImportedKeys(results: readonly MigrationRunResult[]): readonly string[] {
  const keys = new Set(
    results
      .flatMap((result) => result.diagnostics)
      .filter((diagnostic) => diagnostic.startsWith(NOT_IMPORTED_PREFIX))
      .map((diagnostic) => diagnostic.slice(NOT_IMPORTED_PREFIX.length)),
  )
  return [...keys].sort()
}

function legacyBackupPaths(results: readonly MigrationRunResult[]): readonly string[] {
  return [
    ...new Set(
      results.flatMap((result) =>
        result.status === "migrated" ? (result.preview?.backupMoves.map((move) => move.to) ?? []) : [],
      ),
    ),
  ].sort()
}

function skippedConflictCount(results: readonly MigrationRunResult[]): number {
  return results.flatMap((result) => result.diagnostics).filter((diagnostic) => diagnostic.startsWith("skipped:"))
    .length
}

export function runOpenCodeStartupMigration(options: OpenCodeStartupMigrationOptions): OpenCodeStartupMigrationResult {
  const homeDir = homeDirectory(options)
  if (homeDir.length === 0) {
    return {
      error: "Cannot migrate configuration because no home directory is available",
      journalResumed: false,
      legacyBackupPaths: [],
      migratedFrom: [],
      notImportedKeys: [],
      reloadRequired: false,
      results: [],
      skippedConflictCount: 0,
      targetBackupPaths: [],
    }
  }

  try {
    const batch = runMigrations({
      ...(options.afterMigrations === undefined ? {} : { afterMigrations: options.afterMigrations }),
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
      ...(options.dryRun === undefined ? {} : { dryRun: options.dryRun }),
      ...(options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive }),
      ...(options.onBoundary === undefined ? {} : { onBoundary: options.onBoundary }),
      ...(options.pid === undefined ? {} : { pid: options.pid }),
      discover: () =>
        createLegacyConfigMigrationPlans({
          ...(options.backupTimestamp === undefined ? {} : { backupTimestamp: options.backupTimestamp }),
          cwd: options.cwd,
          ...(options.discoveryFileSystem === undefined ? {} : { fileSystem: options.discoveryFileSystem }),
          environment: options.environment ?? process.env,
          homeDir,
          pathOperations: options.pathOperations ?? posix,
          ...(options.platform === undefined ? {} : { platform: options.platform }),
        }),
    })
    const migratedFrom = uniqueSources(batch.results)
    const targetBackupPaths = [
      ...(batch.resumedTargetBackupPath === undefined ? [] : [batch.resumedTargetBackupPath]),
      ...batch.results.flatMap((result) => (result.targetBackupPath === undefined ? [] : [result.targetBackupPath])),
    ]
    return {
      journalResumed: batch.journalResumed,
      legacyBackupPaths: legacyBackupPaths(batch.results),
      migratedFrom,
      notImportedKeys: notImportedKeys(batch.results),
      reloadRequired: batch.journalResumed || migratedFrom.length > 0,
      results: batch.results,
      skippedConflictCount: skippedConflictCount(batch.results),
      targetBackupPaths,
      ...(batch.resumedTargetBackupPath === undefined
        ? {}
        : { resumedTargetBackupPath: batch.resumedTargetBackupPath }),
      ...(batch.status === "locked" ? { error: "Configuration migration is already running" } : {}),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,
      legacyBackupPaths: [],
      migratedFrom: [],
      notImportedKeys: [],
      reloadRequired: false,
      results: [],
      skippedConflictCount: 0,
      targetBackupPaths: [],
    }
  }
}
