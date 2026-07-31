import { posix, win32 } from "node:path"

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
} from "@oh-my-opencode/omo-opencode/config-migration"

import type { ComponentContext, OmoSenpiComponent, SenpiExtensionAPI } from "../../extension/types"
import { loadSenpiOmoConfig, type SenpiOmoConfigResult } from "../config-resolution"

export type SenpiStartupMigrationOptions = {
  readonly backupTimestamp?: string
  readonly clock?: MigrationClock
  readonly cwd: string
  readonly discoveryFileSystem?: ConfigMigrationDiscoveryFileSystem
  readonly env?: MigrationEnvironment
  readonly environment?: Readonly<Record<string, string | undefined>>
  readonly fileSystem?: MigrationFileSystem
  readonly homeDir?: string
  readonly isProcessAlive?: (pid: number) => boolean
  readonly onBoundary?: (boundary: MigrationBoundary) => void
  readonly pathOperations?: ConfigMigrationPathOperations
  readonly pid?: number
  readonly platform?: NodeJS.Platform
}

export type SenpiStartupMigrationResult = {
  readonly error?: string
  readonly journalResumed: boolean
  readonly migratedFrom: readonly string[]
  readonly results: readonly MigrationRunResult[]
}

export interface ConfigStartupComponentOptions {
  readonly loadConfig?: typeof loadSenpiOmoConfig
  readonly resolveCwd?: () => string
  readonly runMigration?: (options: SenpiStartupMigrationOptions) => SenpiStartupMigrationResult
}

type NotificationUi = {
  notify(message: string, type?: "info" | "warning" | "error"): void
}

function homeDirectory(options: SenpiStartupMigrationOptions): string {
  const environment = options.environment ?? process.env
  return options.homeDir ?? environment["HOME"] ?? environment["USERPROFILE"] ?? ""
}

function migratedSources(results: readonly MigrationRunResult[]): readonly string[] {
  return [...new Set(results.flatMap((result) => result.status === "migrated"
    ? result.preview?.backupMoves.map((move) => move.from) ?? []
    : []))].sort()
}

/** Runs the shared, lock-protected migration engine before Senpi reads its unified configuration. */
export function runSenpiStartupMigration(options: SenpiStartupMigrationOptions): SenpiStartupMigrationResult {
  const homeDir = homeDirectory(options)
  if (homeDir.length === 0) {
    return {
      error: "Cannot migrate configuration because no home directory is available",
      journalResumed: false,
      migratedFrom: [],
      results: [],
    }
  }

  try {
    const batch = runMigrations({
      ...(options.clock === undefined ? {} : { clock: options.clock }),
      ...(options.env === undefined ? {} : { env: options.env }),
      ...(options.fileSystem === undefined ? {} : { fileSystem: options.fileSystem }),
      ...(options.isProcessAlive === undefined ? {} : { isProcessAlive: options.isProcessAlive }),
      ...(options.onBoundary === undefined ? {} : { onBoundary: options.onBoundary }),
      ...(options.pid === undefined ? {} : { pid: options.pid }),
      discover: () => createLegacyConfigMigrationPlans({
        ...(options.backupTimestamp === undefined ? {} : { backupTimestamp: options.backupTimestamp }),
        cwd: options.cwd,
        ...(options.discoveryFileSystem === undefined ? {} : { fileSystem: options.discoveryFileSystem }),
        environment: options.environment ?? process.env,
        homeDir,
        pathOperations: options.pathOperations ?? (options.platform === "win32" ? win32 : posix),
        ...(options.platform === undefined ? {} : { platform: options.platform }),
      }),
    })
    return {
      ...(batch.status === "locked" ? { error: "Configuration migration is already running" } : {}),
      journalResumed: batch.journalResumed,
      migratedFrom: migratedSources(batch.results),
      results: batch.results,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : String(error),
      journalResumed: false,
      migratedFrom: [],
      results: [],
    }
  }
}

export function createConfigStartupComponent(options: ConfigStartupComponentOptions = {}): OmoSenpiComponent {
  const loadConfig = options.loadConfig ?? loadSenpiOmoConfig
  const resolveCwd = options.resolveCwd ?? (() => process.cwd())
  const runMigration = options.runMigration ?? runSenpiStartupMigration
  return {
    name: "config-startup",
    register(pi: SenpiExtensionAPI, ctx: ComponentContext): void {
      const cwd = resolveCwd()
      const migration = runMigration({ cwd })
      const config = loadConfig({ cwd })
      const notices = notificationMessages(migration, config)
      let reported = false
      pi.on("session_start", (_payload, eventCtx) => {
        if (reported || notices.length === 0) return
        reported = true
        for (const notice of notices) notifyOrLog(eventCtx, ctx, notice.message, notice.type)
      })
    },
  }
}

function notificationMessages(
  migration: SenpiStartupMigrationResult,
  config: SenpiOmoConfigResult,
): readonly { readonly message: string; readonly type: "info" | "warning" }[] {
  const messages: { message: string; type: "info" | "warning" }[] = []
  if (migration.error !== undefined) messages.push({ message: `omo-senpi: configuration migration: ${migration.error}`, type: "warning" })
  else if (migration.migratedFrom.length > 0) messages.push({
    message: `omo-senpi: migrated legacy configuration from ${migration.migratedFrom.join(", ")}`,
    type: "info",
  })
  else if (migration.journalResumed) messages.push({ message: "omo-senpi: recovered an interrupted configuration migration", type: "info" })
  const migrationDiagnostics = migration.results.flatMap((result) => result.diagnostics)
  if (migrationDiagnostics.length > 0) messages.push({
    message: `omo-senpi: configuration migration: ${migrationDiagnostics.join("; ")}`,
    type: "warning",
  })
  if (config.diagnostics.length > 0) messages.push({
    message: `omo-senpi: configuration diagnostics: ${config.diagnostics.map((diagnostic) => diagnostic.message).join("; ")}`,
    type: "warning",
  })
  return messages
}

function notificationUi(value: unknown): NotificationUi | undefined {
  if (typeof value !== "object" || value === null || !("ui" in value)) return undefined
  return isNotificationUi(value.ui) ? value.ui : undefined
}

function isNotificationUi(value: unknown): value is NotificationUi {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "notify") === "function"
}

function notifyOrLog(eventCtx: unknown, ctx: ComponentContext, message: string, type: "info" | "warning"): void {
  const ui = notificationUi(eventCtx)
  if (ui !== undefined) {
    ui.notify(message, type)
    return
  }
  if (type === "warning") ctx.logger.warn(message)
  else ctx.logger.info(message)
}
