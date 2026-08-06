import { dirname, posix } from "node:path"

import { isPlainObject } from "../internal/plain-object"
import { parseJsoncSafe } from "../internal/jsonc-parse"
import { moveMigrationBackup } from "./backup-move"
import { prepareTargetReplacement, prepareTargetWrite, targetDocument, writeOmoMigrationTarget, writePreparedTarget } from "./commit"
import { type MigrationBackupMove, migrationJournalPath, removeMigrationJournal, writeMigrationJournal } from "./journal"
import { acquireMigrationLock, migrationLockPath } from "./lock"
import { shouldRunMigration } from "./predicate"
import { resumeMigrationJournal } from "./recovery"
import {
  DEFAULT_MIGRATION_CLOCK,
  DEFAULT_MIGRATION_FILE_SYSTEM,
  DEFAULT_MIGRATION_PROCESS,
  MigrationTransactionError,
  type LoadedMigrationSource,
  type MigrationBatchRunResult,
  type MigrationClock,
  type MigrationEnvironment,
  type MigrationFileSystem,
  type MigrationPlan,
  type MigrationProcess,
  type MigrationRunResult,
  type MigrationSourceDescriptor,
  type RunMigrationsOptions,
} from "./types"

function parseSource(path: string, content: string): unknown {
  const parsed = parseJsoncSafe<unknown>(content)
  if (parsed.errors.length > 0) {
    const detail = parsed.errors.map((error) => `${error.message} at ${error.offset}`).join(", ")
    throw new MigrationTransactionError(`Migration source at ${path} is invalid JSONC: ${detail}`)
  }
  return parsed.data
}

function loadSources(sources: readonly MigrationSourceDescriptor[], fileSystem: MigrationFileSystem): readonly LoadedMigrationSource[] {
  return sources
    .filter((source) => fileSystem.existsSync(source.path))
    .map((source) => ({ ...source, value: parseSource(source.path, fileSystem.readFileSync(source.path, "utf-8")) }))
}

function backupBasePath(source: MigrationSourceDescriptor, migrationId: string): string {
  return source.backupPath ?? `${source.path}.bak.${encodeURIComponent(migrationId)}`
}

function backupMoves(
  sources: readonly MigrationSourceDescriptor[],
  migrationId: string,
  fileSystem: MigrationFileSystem,
  protectedPaths: ReadonlySet<string>,
): readonly MigrationBackupMove[] {
  const paths = new Set(sources.map((source) => source.path))
  const destinations = new Set<string>()
  const moves: MigrationBackupMove[] = []
  for (const source of sources) {
    if (!fileSystem.existsSync(source.path)) continue
    const basePath = backupBasePath(source, migrationId)
    let destination = basePath
    let attempt = 1
    while (fileSystem.existsSync(destination) || destinations.has(destination)) {
      if (source.backupPath !== undefined) throw new MigrationTransactionError(`Migration backup path already exists: ${destination}`)
      destination = `${basePath}.${attempt}`
      attempt += 1
    }
    if (paths.has(destination) || protectedPaths.has(destination)) throw new MigrationTransactionError(`Migration backup path is protected: ${destination}`)
    destinations.add(destination)
    moves.push({ from: source.path, to: destination })
  }
  return moves
}

function assertSafeSourcePaths(sources: readonly MigrationSourceDescriptor[], protectedPaths: ReadonlySet<string>): void {
  const seen = new Set<string>()
  for (const source of sources) {
    if (seen.has(source.path)) throw new MigrationTransactionError(`Duplicate migration source: ${source.path}`)
    if (protectedPaths.has(source.path)) throw new MigrationTransactionError(`Migration source is protected: ${source.path}`)
    seen.add(source.path)
  }
}

function directoryPath(path: string): string {
  return path.startsWith("/") ? posix.dirname(path) : dirname(path)
}

function ensureBackupDirectories(moves: readonly MigrationBackupMove[], fileSystem: MigrationFileSystem): void {
  for (const move of moves) fileSystem.mkdirSync(directoryPath(move.to), { recursive: true })
}

function transformResult(value: ReturnType<MigrationPlan["transform"]>): {
  readonly diagnostics: readonly string[]
  readonly document: Readonly<Record<string, unknown>>
} {
  if (isPlainObject(value) && isPlainObject(value.document) && Array.isArray(value.diagnostics) && value.diagnostics.every((diagnostic) => typeof diagnostic === "string")) {
    return { diagnostics: value.diagnostics, document: value.document }
  }
  if (!isPlainObject(value)) throw new MigrationTransactionError("Migration transform must return a plain object")
  return { diagnostics: [], document: value }
}

function executePlan(input: {
  readonly clock: MigrationClock
  readonly dryRun: boolean
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly journalResumed: boolean
  readonly onBoundary: RunMigrationsOptions["onBoundary"]
  readonly plan: MigrationPlan
  readonly process: MigrationProcess
  readonly renewLock: () => void
  readonly writeTarget: NonNullable<RunMigrationsOptions["writeTarget"]>
}): MigrationRunResult {
  const { env, fileSystem, journalResumed, plan } = input
  const protectedPaths = new Set([plan.targetPath, migrationJournalPath(env), migrationLockPath(env)])
  assertSafeSourcePaths(plan.sources, protectedPaths)
  const existingSources = plan.sources.filter((source) => fileSystem.existsSync(source.path))
  const target = targetDocument(plan.targetPath, fileSystem)
  const replaceTarget = plan.mode === "replace-target"
  if (!shouldRunMigration({
    legacySourcesExist: replaceTarget ? fileSystem.existsSync(plan.targetPath) : existingSources.length > 0,
    migrationId: plan.id,
    target,
  })) {
    return { diagnostics: [], journalResumed, status: "skipped" }
  }

  const loaded = replaceTarget
    ? [{ path: plan.targetPath, value: target }]
    : loadSources(existingSources, fileSystem)
  const transformed = transformResult(plan.transform(loaded))
  const prepared = replaceTarget
    ? prepareTargetReplacement({ document: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath })
    : prepareTargetWrite({ additions: transformed.document, migrationId: plan.id, target, targetPath: plan.targetPath })
  const diagnostics = [...transformed.diagnostics, ...prepared.diagnostics]
  const moves = backupMoves(existingSources, plan.id, fileSystem, protectedPaths)
  const preview = { backupMoves: moves, targetPath: plan.targetPath, transform: transformed.document }
  if (input.dryRun) return { diagnostics, journalResumed, preview, status: "planned" }

  ensureBackupDirectories(moves, fileSystem)
  const journal = {
    backupMoves: moves,
    completedMoves: [],
    diagnostics,
    migrationId: plan.id,
    targetPath: plan.targetPath,
    targetWrite: {
      additions: transformed.document,
      ...(replaceTarget ? { mode: "replace-target" as const } : {}),
    },
    targetWritten: false,
    version: 1 as const,
  }
  writeMigrationJournal(journal, fileSystem, env, input.process, input.clock)
  input.onBoundary?.("journal-written")
  input.renewLock()
  writePreparedTarget({ env, fileSystem, prepared, targetPath: plan.targetPath, writeTarget: input.writeTarget })
  input.onBoundary?.("target-written")
  const targetRecorded = { ...journal, targetWritten: true }
  writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock)
  input.onBoundary?.("target-recorded")
  for (const move of targetRecorded.backupMoves) {
    input.renewLock()
    if (fileSystem.existsSync(move.to)) throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`)
    moveMigrationBackup(fileSystem, move.from, move.to)
    input.onBoundary?.("source-moved")
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] })
    writeMigrationJournal(targetRecorded, fileSystem, env, input.process, input.clock)
    input.onBoundary?.("source-recorded")
  }
  removeMigrationJournal(fileSystem, env)
  return { diagnostics, journalResumed, preview, status: "migrated" }
}

export function runMigrations(options: RunMigrationsOptions): MigrationBatchRunResult {
  const clock = options.clock ?? DEFAULT_MIGRATION_CLOCK
  const home = globalThis.process.env["HOME"]
  const userProfile = globalThis.process.env["USERPROFILE"]
  const env = options.env ?? { ...(home === undefined ? {} : { HOME: home }), ...(userProfile === undefined ? {} : { USERPROFILE: userProfile }) }
  const fileSystem = options.fileSystem ?? DEFAULT_MIGRATION_FILE_SYSTEM
  const process: MigrationProcess = { isAlive: options.isProcessAlive ?? DEFAULT_MIGRATION_PROCESS.isAlive, pid: options.pid ?? DEFAULT_MIGRATION_PROCESS.pid }
  const writeTarget = options.writeTarget ?? writeOmoMigrationTarget
  const lock = acquireMigrationLock({ clock, env, fileSystem, ...(options.leaseDurationMs === undefined ? {} : { leaseDurationMs: options.leaseDurationMs }), process })
  if (lock === null) return { journalResumed: false, results: [], status: "locked" }

  try {
    const journalResumed = resumeMigrationJournal({ clock, env, fileSystem, process, renewLock: lock.renew, writeTarget })
    lock.renew()
    const results = options.discover().map((plan) => executePlan({
      clock,
      dryRun: options.dryRun ?? false,
      env,
      fileSystem,
      journalResumed,
      onBoundary: options.onBoundary,
      plan,
      process,
      renewLock: lock.renew,
      writeTarget,
    }))
    if (options.dryRun !== true) options.afterMigrations?.(results)
    return { journalResumed, results, status: "completed" }
  } finally {
    lock.release()
  }
}
