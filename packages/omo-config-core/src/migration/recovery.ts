import { moveMigrationBackup } from "./backup-move"
import { prepareTargetReplacement, prepareTargetWrite, targetDocument, writePreparedTarget } from "./commit"
import { readMigrationJournal, removeMigrationJournal, writeMigrationJournal } from "./journal"
import { hasMigrationMarker } from "./predicate"
import { MigrationTransactionError, type MigrationClock, type MigrationEnvironment, type MigrationFileSystem, type MigrationProcess, type MigrationTargetWriter } from "./types"

/**
 * The planned name is kept when it is free or already holds this target's bytes (a crashed run's copy).
 * A foreign file there is left alone and the next free `<planned>.N` name is used instead (#8187).
 */
function backupPathForResume(planned: string | undefined, targetPath: string, fileSystem: MigrationFileSystem): string | undefined {
  if (planned === undefined || !fileSystem.existsSync(planned) || !fileSystem.existsSync(targetPath)) return planned
  if (fileSystem.readFileSync(planned, "utf-8") === fileSystem.readFileSync(targetPath, "utf-8")) return planned
  let attempt = 1
  while (fileSystem.existsSync(`${planned}.${attempt}`)) attempt += 1
  return `${planned}.${attempt}`
}

export function resumeMigrationJournal(input: {
  readonly clock: MigrationClock
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly process: MigrationProcess
  readonly renewLock: () => void
  readonly writeTarget: MigrationTargetWriter
}): { readonly resumed: boolean; readonly targetBackupPath?: string } {
  const read = readMigrationJournal(input.fileSystem, input.env)
  if (read === null) return { resumed: false }
  let journal = read

  input.renewLock()
  const target = targetDocument(journal.targetPath, input.fileSystem)
  let writtenBackupPath: string | undefined
  if (!hasMigrationMarker(target, journal.migrationId)) {
    const prepared = journal.targetWrite.mode === "replace-target"
      ? prepareTargetReplacement({
        document: journal.targetWrite.additions,
        migrationId: journal.migrationId,
        target,
        targetPath: journal.targetPath,
      })
      : prepareTargetWrite({
        additions: journal.targetWrite.additions,
        migrationId: journal.migrationId,
        target,
        targetPath: journal.targetPath,
      })
    const backupPath = backupPathForResume(journal.targetBackupPath, journal.targetPath, input.fileSystem)
    if (backupPath !== journal.targetBackupPath && backupPath !== undefined) {
      // Record the name before writing it, so a crash after the target write still names the right file.
      journal = { ...journal, targetBackupPath: backupPath }
      writeMigrationJournal(journal, input.fileSystem, input.env, input.process, input.clock)
    }
    writtenBackupPath = writePreparedTarget({
      ...(journal.targetBackupPath === undefined ? {} : { backupPath: journal.targetBackupPath }),
      env: input.env,
      fileSystem: input.fileSystem,
      prepared,
      targetPath: journal.targetPath,
      writeTarget: input.writeTarget,
    })
  }

  const targetRecorded = { ...journal, targetWritten: true }
  writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock)
  for (const move of targetRecorded.backupMoves) {
    if (targetRecorded.completedMoves.includes(move.from)) continue
    input.renewLock()
    if (input.fileSystem.existsSync(move.from)) {
      if (input.fileSystem.existsSync(move.to)) {
        throw new MigrationTransactionError(`Migration backup path already exists: ${move.to}`)
      }
      moveMigrationBackup(input.fileSystem, move.from, move.to)
    } else if (!input.fileSystem.existsSync(move.to)) {
      throw new MigrationTransactionError(`Migration source and backup are both missing: ${move.from}`)
    }
    Object.assign(targetRecorded, { completedMoves: [...targetRecorded.completedMoves, move.from] })
    writeMigrationJournal(targetRecorded, input.fileSystem, input.env, input.process, input.clock)
  }
  removeMigrationJournal(input.fileSystem, input.env)
  // Named whether this resume wrote the target or the crashed run already had: the path was fixed in the journal.
  const targetBackupPath = writtenBackupPath
    ?? (journal.targetBackupPath !== undefined && input.fileSystem.existsSync(journal.targetBackupPath) ? journal.targetBackupPath : undefined)
  return targetBackupPath === undefined ? { resumed: true } : { resumed: true, targetBackupPath }
}
