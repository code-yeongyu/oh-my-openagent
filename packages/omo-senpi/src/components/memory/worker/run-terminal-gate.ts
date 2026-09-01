import { join } from "node:path"

import {
  createLockRecord,
  withLock,
  type AcquireLockOptions,
  type LockRecord,
} from "@oh-my-opencode/memory-core"

type TerminalLock = <T>(
  lockPath: string,
  record: LockRecord,
  operation: () => Promise<T>,
  options: AcquireLockOptions,
) => Promise<T>

export async function withRunTerminalGate<T>(
  runDir: string,
  runId: string,
  operation: () => Promise<T>,
  lock: TerminalLock = withLock,
  createRecord: typeof createLockRecord = createLockRecord,
): Promise<T> {
  const record = await createRecord("reflection-finalize", { runId })
  return lock(join(runDir, "terminalization.lock"), record, operation, {
    waitTimeoutMs: Number.POSITIVE_INFINITY,
  })
}
