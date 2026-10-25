import type { TaskRecord } from "../../state"
import type { RunnerOutcome } from "../in-process/child-handle"
import type { HostSessionPort } from "./handle-port"
import { readInputReceipt } from "./input-receipt"
import { reconcileHostTurn, type ReconciledTurnNotice } from "./reconcile-turn"

/** Retains startup reconciliation until the manager takes ownership of the handle. */
export function createHandleReconciliation(input: {
  readonly lastInputId: () => string | undefined
  readonly port: () => HostSessionPort
  readonly settle: (outcome: RunnerOutcome) => void
  readonly continuing: () => void
}) {
  let record: Pick<TaskRecord, "host_session" | "final_response"> = {}
  let adoptedEntryId: string | undefined
  let pending: ReconciledTurnNotice[] | undefined = []
  const listeners = new Set<(notice: ReconciledTurnNotice) => void>()
  const notify = (notice: ReconciledTurnNotice): void => {
    if (notice.kind === "adopted") adoptedEntryId = notice.entryId
    if (notice.kind === "adopted" && record.host_session !== undefined) {
      record = { host_session: { ...record.host_session, adopted_entry_id: notice.entryId } }
    }
    pending?.push(notice)
    for (const listener of listeners) listener(notice)
  }
  return {
    reconcile: async (sessionPath: string, nextRecord?: Pick<TaskRecord, "host_session" | "final_response">, interruptedWithoutTranscript = false, reopened = false) => {
      if (nextRecord !== undefined) record = nextRecord
      const client = input.port()
      const effectId = input.lastInputId()
      const lastInputEffect = effectId === undefined ? undefined : await readInputReceipt(sessionPath, effectId)
      const result = await reconcileHostTurn({
        getState: () => client.getState(),
        ...(lastInputEffect === undefined ? {} : { lastInputEffect }),
        reopened,
        get adoptedEntryId() { return adoptedEntryId },
        notify,
        settle: input.settle,
        interruptedWithoutTranscript,
      }, record, sessionPath)
      if (result === "continued") input.continuing()
      return result
    },
    subscribe: (listener: (notice: ReconciledTurnNotice) => void): (() => void) => {
      listeners.add(listener)
      for (const notice of pending ?? []) listener(notice)
      queueMicrotask(() => { pending = undefined })
      return () => { listeners.delete(listener) }
    },
  }
}
