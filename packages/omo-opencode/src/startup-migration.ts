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
  readonly migratedFrom: readonly string[]
  readonly reloadRequired: boolean
  readonly results: readonly MigrationRunResult[]
  readonly skippedConflictCount: number
}

function homeDirectory(options: OpenCodeStartupMigrationOptions): string {
  const environment = options.environment ?? process.env
  return options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"] ?? ""
}

function uniqueSources(results: readonly MigrationRunResult[]): readonly string[] {
  return [...new Set(results.flatMap((result) => result.status === "migrated"
    ? result.preview?.backupMoves.map((move) => move.from) ?? []
    : []))].sort()
}

function skippedConflictCount(results: readonly MigrationRunResult[]): number {
  return results.flatMap((result) => result.diagnostics).filter((diagnostic) => diagnostic.startsWith("skipped:")).length
}

export function runOpenCodeStartupMigration(
  options: OpenCodeStartupMigrationOptions,
): OpenCodeStartupMigrationResult {
  const homeDir = homeDirectory(options)
  if (homeDir.length === 0) {
    return {
      error: "Cannot migrate configuration because no home directory is available",
      journalResumed: false,
      migratedFrom: [],
      reloadRequired: false,
      results: [],
      skippedConflictCount: 0,
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
      discover: () => createLegacyConfigMigrationPlans({
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
    return {
      journalResumed: batch.journalResumed,
      migratedFrom,
      reloadRequired: batch.journalResumed || migratedFrom.length > 0,
      results: batch.results,
      skippedConflictCount: skippedConflictCount(batch.results),
      ...(batch.status === "locked" ? { error: "Configuration migration is already running" } : {}),
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,
      migratedFrom: [],
      reloadRequired: false,
      results: [],
      skippedConflictCount: 0,
    }
  }
}
