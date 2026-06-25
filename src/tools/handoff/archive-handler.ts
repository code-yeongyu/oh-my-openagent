import {
  archiveHandoffFile,
  getHandoffConsumedFilePath,
  getHandoffFilePath,
  handoffFileExists,
} from "../../features/handoff"

/**
 * `handoff` tool — `action: "archive"` handler.
 *
 * Renames the active `.matrixx/handoff.md` to `.matrixx/handoff.consumed.md`.
 * Returns a clear `Error:` string if there is no active handoff to archive
 * (idempotent semantics: archiving nothing is an error so the caller knows
 * nothing happened, not a silent no-op).
 */
export function handleArchive(directory: string): string {
  //#given - an active handoff is required
  if (!handoffFileExists(directory)) {
    return `Error: No handoff found at ${getHandoffFilePath(directory)}`
  }

  //#when - rename the file
  const ok = archiveHandoffFile(directory)
  if (!ok) {
    return `Error: failed to archive handoff at ${getHandoffFilePath(directory)}`
  }

  //#then - report success with both paths so the caller can verify
  const from = getHandoffFilePath(directory)
  const to = getHandoffConsumedFilePath(directory)
  return `Handoff archived: ${from} -> ${to}`
}
