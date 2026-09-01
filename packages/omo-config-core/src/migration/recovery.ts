import { moveMigrationBackup } from "./backup-move"
import { prepareTargetReplacement, prepareTargetWrite, targetDocument, writePreparedTarget } from "./commit"
import { readMigrationJournal, removeMigrationJournal, writeMigrationJournal } from "./journal"
import { hasMigrationMarker } from "./predicate"
import { MigrationTransactionError, type MigrationClock, type MigrationEnvironment, type MigrationFileSystem, type MigrationProcess, type MigrationTargetWriter } from "./types"

export function resumeMigrationJournal(input: {
  readonly clock: MigrationClock
  readonly env: MigrationEnvironment
  readonly fileSystem: MigrationFileSystem
  readonly process: MigrationProcess
  readonly renewLock: () => void
  readonly writeTarget: MigrationTargetWriter
}): boolean {
  const journal = readMigrationJournal(input.fileSystem, input.env)
  if (journal === null) return false

  input.renewLock()
  const target = targetDocument(journal.targetPath, input.fileSystem)
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
    writePreparedTarget({
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
  return true
}
