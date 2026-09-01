import { join } from "node:path"
import { isPlainObject } from "../internal/plain-object"
import { toPosixPath } from "../internal/posix-path"
import { resolveHomeDir } from "../loader"
import type { MigrationClock, MigrationEnvironment, MigrationFileSystem, MigrationProcess } from "./types"

export type MigrationBackupMove = {
  readonly from: string
  readonly to: string
}

export type MigrationJournal = {
  readonly backupMoves: readonly MigrationBackupMove[]
  readonly diagnostics: readonly string[]
  readonly completedMoves: readonly string[]
  readonly migrationId: string
  readonly targetPath: string
  readonly targetWrite: {
    readonly additions: Record<string, unknown>
    readonly mode?: "replace-target"
  }
  readonly targetWritten: boolean
  readonly version: 1
}

export function migrationJournalPath(env: MigrationEnvironment): string {
  return toPosixPath(join(resolveHomeDir(env), ".omo", ".migration-journal.json"))
}

function isFileExistsError(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, "code") === "EEXIST"
}

function journalTempPath(path: string, process: MigrationProcess, clock: MigrationClock, attempt: number): string {
  const suffix = `${process.pid}.${clock.now()}`
  return attempt === 0 ? `${path}.${suffix}.tmp` : `${path}.${suffix}.${attempt}.tmp`
}

function parseJournal(value: unknown): MigrationJournal {
  if (!isPlainObject(value)) throw new Error("Migration journal must be an object")
  if (value["version"] !== 1) throw new Error("Migration journal version is unsupported")
  if (typeof value["targetPath"] !== "string" || typeof value["migrationId"] !== "string") {
    throw new Error("Migration journal target is invalid")
  }
  if (!isPlainObject(value["targetWrite"]) || !isPlainObject(value["targetWrite"]["additions"])) {
    throw new Error("Migration journal target write is invalid")
  }
  const targetWriteMode = value["targetWrite"]["mode"]
  if (targetWriteMode !== undefined && targetWriteMode !== "replace-target") {
    throw new Error("Migration journal target write mode is invalid")
  }
  if (typeof value["targetWritten"] !== "boolean" || !Array.isArray(value["completedMoves"])) {
    throw new Error("Migration journal completion state is invalid")
  }
  const diagnostics = value["diagnostics"]
  if (diagnostics !== undefined && (!Array.isArray(diagnostics) || !diagnostics.every((entry) => typeof entry === "string"))) {
    throw new Error("Migration journal diagnostics are invalid")
  }
  if (!value["completedMoves"].every((path) => typeof path === "string")) {
    throw new Error("Migration journal completed moves are invalid")
  }
  if (!Array.isArray(value["backupMoves"])) throw new Error("Migration journal backup plan is invalid")

  const backupMoves: MigrationBackupMove[] = []
  for (const move of value["backupMoves"]) {
    if (!isPlainObject(move) || typeof move["from"] !== "string" || typeof move["to"] !== "string") {
      throw new Error("Migration journal backup move is invalid")
    }
    backupMoves.push({ from: move["from"], to: move["to"] })
  }

  return {
    backupMoves,
    completedMoves: [...value["completedMoves"]],
    diagnostics: diagnostics === undefined ? [] : [...diagnostics],
    migrationId: value["migrationId"],
    targetPath: value["targetPath"],
    targetWrite: {
      additions: { ...value["targetWrite"]["additions"] },
      ...(targetWriteMode === undefined ? {} : { mode: targetWriteMode }),
    },
    targetWritten: value["targetWritten"],
    version: 1,
  }
}

export function readMigrationJournal(
  fileSystem: MigrationFileSystem,
  env: MigrationEnvironment,
): MigrationJournal | null {
  const path = migrationJournalPath(env)
  if (!fileSystem.existsSync(path)) return null
  return parseJournal(JSON.parse(fileSystem.readFileSync(path, "utf-8")))
}

export function writeMigrationJournal(
  journal: MigrationJournal,
  fileSystem: MigrationFileSystem,
  env: MigrationEnvironment,
  process: MigrationProcess,
  clock: MigrationClock,
): void {
  const path = migrationJournalPath(env)
  const content = `${JSON.stringify(journal)}\n`
  let attempt = 0

  while (true) {
    const temporaryPath = journalTempPath(path, process, clock, attempt)
    try {
      fileSystem.writeFileExclusiveSync(temporaryPath, content)
      fileSystem.renameSync(temporaryPath, path)
      return
    } catch (error) {
      if (!isFileExistsError(error)) throw error
      attempt += 1
    }
  }
}

export function removeMigrationJournal(fileSystem: MigrationFileSystem, env: MigrationEnvironment): void {
  const path = migrationJournalPath(env)
  if (fileSystem.existsSync(path)) fileSystem.unlinkSync(path)
}
