import { DEFAULT_WRITE_FILE_SYSTEM, type OmoConfigEdit, type OmoConfigWriteFileSystem } from "../writer"

export type MigrationEnvironment = {
  readonly HOME?: string
  readonly USERPROFILE?: string
}

export type MigrationClock = {
  readonly now: () => number
}

export type MigrationProcess = {
  readonly isAlive: (pid: number) => boolean
  readonly pid: number
}

export type MigrationFileSystem = OmoConfigWriteFileSystem & {
  readonly replaceIfContentsMatchSync: (path: string, expected: string, content: string) => boolean
  readonly removeIfContentsMatchSync: (path: string, expected: string) => boolean
}

export type MigrationSourceDescriptor = {
  readonly backupPath?: string
  readonly path: string
}

export type LoadedMigrationSource = MigrationSourceDescriptor & {
  readonly value: unknown
}

export type MigrationTransformResult = {
  readonly diagnostics: readonly string[]
  readonly document: Readonly<Record<string, unknown>>
}

export type MigrationTransform = (
  sources: readonly LoadedMigrationSource[],
) => Readonly<Record<string, unknown>> | MigrationTransformResult

export type MigrationTargetWriter = (input: {
  readonly edits: readonly OmoConfigEdit[]
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly targetPath: string
}) => void

export type MigrationBoundary =
  | "journal-written"
  | "target-written"
  | "target-recorded"
  | "source-moved"
  | "source-recorded"

export type MigrationPlan = {
  readonly id: string
  /** Rewrites the current target document instead of no-clobber merging separate legacy sources. */
  readonly mode?: "merge" | "replace-target"
  readonly sources: readonly MigrationSourceDescriptor[]
  readonly targetPath: string
  readonly transform: MigrationTransform
}

export type RunMigrationOptions = {
  readonly clock?: MigrationClock
  readonly env?: MigrationEnvironment
  readonly fileSystem?: MigrationFileSystem
  readonly id: string
  readonly isProcessAlive?: (pid: number) => boolean
  readonly leaseDurationMs?: number
  readonly mode?: "merge" | "replace-target"
  readonly onBoundary?: (boundary: MigrationBoundary) => void
  readonly pid?: number
  readonly sources: readonly MigrationSourceDescriptor[]
  readonly targetPath: string
  readonly transform: MigrationTransform
  readonly writeTarget?: MigrationTargetWriter
}

export type MigrationPreview = {
  readonly backupMoves: readonly { readonly from: string; readonly to: string }[]
  readonly targetPath: string
  readonly transform: Readonly<Record<string, unknown>>
}

export type MigrationRunResult = {
  readonly diagnostics: readonly string[]
  readonly journalResumed: boolean
  readonly preview?: MigrationPreview
  readonly status: "locked" | "migrated" | "planned" | "skipped"
}

export type RunMigrationsOptions = Omit<
  RunMigrationOptions,
  "id" | "mode" | "sources" | "targetPath" | "transform"
> & {
  readonly afterMigrations?: (results: readonly MigrationRunResult[]) => void
  readonly discover: () => readonly MigrationPlan[]
  readonly dryRun?: boolean
}

export type MigrationBatchRunResult = {
  readonly journalResumed: boolean
  readonly results: readonly MigrationRunResult[]
  readonly status: "completed" | "locked"
}

export class MigrationValidationError extends Error {
  override readonly name = "MigrationValidationError"

  constructor(readonly targetPath: string, message: string) {
    super(`Migration validation failed for ${targetPath}: ${message}`)
  }
}

export class MigrationTransactionError extends Error {
  override readonly name = "MigrationTransactionError"

  constructor(message: string) {
    super(message)
  }
}

export const DEFAULT_MIGRATION_CLOCK: MigrationClock = {
  now: () => Date.now(),
}

export const DEFAULT_MIGRATION_PROCESS: MigrationProcess = {
  isAlive: (pid: number): boolean => {
    try {
      process.kill(pid, 0)
      return true
    } catch (error) {
      if (!(error instanceof Error)) throw error
      return Reflect.get(error, "code") !== "ESRCH"
    }
  },
  pid: process.pid,
}

export const DEFAULT_MIGRATION_FILE_SYSTEM: MigrationFileSystem = {
  ...DEFAULT_WRITE_FILE_SYSTEM,
  removeIfContentsMatchSync: (path: string, expected: string): boolean => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path)) return false
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected) return false
    DEFAULT_WRITE_FILE_SYSTEM.unlinkSync(path)
    return true
  },
  replaceIfContentsMatchSync: (path: string, expected: string, content: string): boolean => {
    if (!DEFAULT_WRITE_FILE_SYSTEM.existsSync(path)) return false
    if (DEFAULT_WRITE_FILE_SYSTEM.readFileSync(path, "utf-8") !== expected) return false
    DEFAULT_WRITE_FILE_SYSTEM.writeFileSync(path, content, "utf-8")
    return true
  },
}
