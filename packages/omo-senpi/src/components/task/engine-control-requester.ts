import { log } from "@oh-my-opencode/utils"
import { createRequesterChannel } from "../../../../senpi-task/src/control/requester-channel"
import type { TaskLifecycle } from "../../../../senpi-task/src/lifecycle"
import type { TaskManager } from "../../../../senpi-task/src/manager/types"
import type { TaskRecord } from "../../../../senpi-task/src/state"
import type { TaskRecordStore } from "../../../../senpi-task/src/store"
import { createGuidanceCarry, type GuidanceCarry } from "./engine-run-pause-carry"
import { ownedSubtree, type createEngineRunPause } from "./engine-run-pause"
import { createRemoteCancel } from "./engine-remote-cancel"

const WATCH_MS = 1_000

// The requester half of the #12349 control channel for one session's manager: the channel, the
// remote run-pause effects' ports, the cancel carry and its watcher, and the guidance carry.
export function composeControlRequester(input: {
  readonly stateDir: string
  readonly store: TaskRecordStore
  readonly manager: TaskManager
  readonly lifecycle: Pick<TaskLifecycle, "finishPendingCancel">
  readonly channel: boolean
  readonly isProcessAlive: (pid: number) => boolean
  readonly hostPid?: number
}) {
  const { manager } = input
  const channel = createRequesterChannel({ stateDir: input.stateDir, store: input.store, hostPid: input.hostPid ?? process.pid,
    managerInstance: manager.managerInstance ?? "unknown", channel: input.channel, isProcessAlive: input.isProcessAlive })
  let runPause: ReturnType<typeof createEngineRunPause> | undefined
  let carry: GuidanceCarry | undefined
  const remoteCancel = createRemoteCancel({
    channel, store: input.store,
    finish: record => input.lifecycle.finishPendingCancel?.(record) ?? Promise.resolve(),
    holds: taskId => manager.holdsLiveHandle?.(taskId) === true,
    pauseSeq: parent => runPause?.registry.load(parent)?.pauseSeq ?? 0,
  })
  let timer: ReturnType<typeof setInterval> | undefined
  return {
    channel, remoteCancel,
    remote: { channel, store: input.store, isProcessAlive: input.isProcessAlive, armCancelWatcher: (taskId: string) => remoteCancel.arm(taskId) },
    bind(bound: ReturnType<typeof createEngineRunPause>): void {
      runPause = bound
      carry = createGuidanceCarry({ channel, registry: bound.registry })
    },
    carry: (): GuidanceCarry | undefined => carry,
    cancel: (record: TaskRecord, reason: string | undefined) => remoteCancel.cancel(record, reason),
    // Re-arm at session start, independent of any pause ledger (design 3.7; notes nit 4).
    rearm(sessionId: string): void {
      remoteCancel.rearm(ownedSubtree(manager.list({ scope: "all" }).map(entry => entry.record), sessionId))
    },
    start(sessionId: () => string | undefined): void {
      if (timer !== undefined) return
      timer = setInterval(() => {
        const session = sessionId()
        void remoteCancel.tick().then(() => session === undefined ? undefined : runPause?.bridge.tickRemote(session))
          .catch((error: unknown) => log("[omo-senpi] control requester tick failed", { error: String(error) }))
      }, WATCH_MS)
      timer.unref?.()
    },
    stop(): void { if (timer !== undefined) clearInterval(timer); timer = undefined },
  }
}

export type ControlRequester = ReturnType<typeof composeControlRequester>
