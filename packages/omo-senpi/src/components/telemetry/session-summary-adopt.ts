import { CORRUPT, removeFile } from "./session-summary-files"
import type { LiveWindow } from "./omo-native-session-summary"
import type { RecoveryStorage } from "./session-summary-recovery-storage"
import { isRecordSendable, type ConsentScope, type WindowRecord } from "./session-summary-storage"
import { newSummaryEpoch } from "./session-summary-window"

/**
 * Continues the window another process wrote for this session once that process is gone, claiming the file
 * first so two resuming processes never both continue it. A live owner, or a claim another process won,
 * leaves this process its own copy beside the shared file. Only a session resumed from another process gets
 * here, so this ships in the recovery sidecar. The continuation numbers in a new epoch (see below).
 */
export function adoptForeignWindow(input: {
  readonly storage: RecoveryStorage
  readonly key: string
  readonly ownCopy: string
  readonly stored: WindowRecord
  readonly isScopeConsented: (scope: ConsentScope) => boolean
  readonly fresh: (key?: string, epoch?: string, seq?: number) => LiveWindow
  readonly persist: (entry: LiveWindow) => void
}): LiveWindow {
  const { storage, key, fresh } = input
  if (storage.isOwnerAlive(input.stored.owner)) return fresh(input.ownCopy)
  const claimed = storage.claimWindow(key)
  if (claimed === undefined) return fresh(input.ownCopy)
  const record = claimed.record
  if (record === undefined || record === CORRUPT || !isRecordSendable(record, input.isScopeConsented)) {
    removeFile(claimed.claimPath)
    return fresh()
  }
  // A new epoch on every hand-over: if the owner was misjudged dead and still publishes, no (epoch, seq) repeats.
  const epoch = newSummaryEpoch()
  const published = record.windowId !== null && storage.hasPending(record.windowId)
  const entry: LiveWindow = published || record.window === null
    ? fresh(key, epoch, published ? record.seq + 1 : record.seq)
    : { key, epoch, seq: record.seq, sampleRate: record.sampleRate, windowId: record.windowId, window: record.window }
  input.persist(entry)
  removeFile(claimed.claimPath)
  return entry
}
