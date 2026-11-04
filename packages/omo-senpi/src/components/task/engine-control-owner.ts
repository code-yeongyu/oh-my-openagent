import { log } from "@oh-my-opencode/utils"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../senpi-task/src/manager/run-pause"
import { ControlInbox } from "../../../../senpi-task/src/control/control-inbox"
import type { ControlOwnerPort } from "../../../../senpi-task/src/control/owner-port"
import type { AdmissionBarrier } from "../../../../senpi-task/src/pause/admission-barrier"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { TaskRecordStore } from "../../../../senpi-task/src/store"
import { ownedSubtree, type createEngineRunPause } from "./engine-run-pause"

export type ControlOwnerRegistration = { release(): Promise<void> }

// Registers this session's task manager with the process's control inbox (#12349 part 2). With
// `task.control_channel: false` the manager still joins the in-memory sibling registry (notes nit 5)
// but runs no inbox, writes no advertisement and answers no register.
export function registerControlOwner(input: {
  readonly stateDir: string
  readonly store: TaskRecordStore
  readonly manager: TaskManager & TaskPauseMethods
  readonly barrier: AdmissionBarrier
  readonly runPause: ReturnType<typeof createEngineRunPause>
  readonly sessionId: () => string | undefined
  readonly ownsRecord: (record: TaskRecord) => boolean
  readonly channel: boolean
  readonly hostPid?: number
}): ControlOwnerRegistration {
  const { manager } = input
  const managerInstance = manager.managerInstance
  if (managerInstance === undefined || manager.holdsLiveHandle === undefined) return { release: async () => undefined }
  const holds = (taskId: string): boolean => manager.holdsLiveHandle?.(taskId) === true
  const port: ControlOwnerPort = {
    managerInstance,
    hostPid: input.hostPid ?? process.pid,
    sessionId: input.sessionId,
    holds,
    load: taskId => manager.get(taskId),
    ownsRecord: input.ownsRecord,
    inAncestry: (record, parentSessionId) => record.parent_session_id === parentSessionId
      || ownedSubtree(manager.list({ scope: "all" }).map(entry => entry.record), parentSessionId).some(entry => entry.task_id === record.task_id),
    pauseTask: (taskId, owner) => manager.pauseTask(taskId, owner),
    holdTaskInput: (taskId, entry) => manager.holdTaskInput(taskId, entry),
    observeTaskHold: (taskId, parent) => manager.observeTaskHold(taskId, parent),
    resumePausedTask: (taskId, request) => manager.resumePausedTask(taskId, request),
    cancelTask: (taskId, reason, options) => manager.cancelTask(taskId, reason, options),
    barrier: input.barrier,
    async releaseRemoteStop({ parentSessionId, pauseSeq, resumeId, credential }) {
      const ledger = input.runPause.registry.load(parentSessionId)
      for (const participant of Object.values(ledger?.participants ?? {})) {
        if (participant.kind !== "held_admission" || participant.runRef.kind !== "task" || manager.resumeHeldTask === undefined) continue
        await manager.resumeHeldTask(participant, credential).catch((error: unknown) => {
          log("[omo-senpi] remote Stop release could not re-admit a held admission", { key: participant.key, error: String(error) })
        })
      }
      input.runPause.controller.noteRemoteRelease(parentSessionId, pauseSeq, resumeId, credential)
    },
  }
  const inbox = ControlInbox.for({ stateDir: input.stateDir, hostPid: port.hostPid, store: input.store })
  const unregister = inbox.register(port, { channel: input.channel, liveTasks: () => manager.residentTaskIds().length })
  let released: Promise<void> | undefined
  return { release: () => released ??= unregister() }
}
