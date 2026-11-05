import { cleanupProjects, seedRecord, tempStore } from "../../../../../senpi-task/src/lifecycle/__fixtures__/lifecycle-fakes"
import { fakeOwner } from "../../../../../senpi-task/src/control/__fixtures__/owner-fakes"
import { ControlInbox } from "../../../../../senpi-task/src/control/control-inbox"
import { createRequesterChannel } from "../../../../../senpi-task/src/control/requester-channel"
import { AdmissionBarrier } from "../../../../../senpi-task/src/pause/admission-barrier"
import type { TaskManager } from "../../../../../senpi-task/src/manager/types"
import type { TaskPauseMethods } from "../../../../../senpi-task/src/manager/run-pause"
import type { TaskRecord } from "../../../../../senpi-task/src/state"
import { createEngineRunPause } from "../engine-run-pause"
import { createGuidanceCarry } from "../engine-run-pause-carry"
import { createRemoteCancel } from "../engine-remote-cancel"

const A_PID = 8101
export const B_PID = 8102
export const T1 = "st_00000001"

const unregisters: (() => Promise<void>)[] = []
export async function cleanupPair(): Promise<void> {
  for (const unregister of unregisters.splice(0)) await unregister()
  cleanupProjects()
}

// Two "processes" over ONE store: B (the owner) holds the live child through the real control inbox
// and a fake engine with run-hold rules; A (the requester) runs the real run controller and effects.
// A's wait for an ack is B's inbox tick plus a clock step, so nothing sleeps.
export function controlPair(input: {
  readonly record?: Partial<TaskRecord>
  readonly ownerTicks?: boolean
  readonly advertise?: boolean
  readonly channel?: boolean
} = {}) {
  const store = tempStore()
  seedRecord(store, { task_id: T1, status: "running", run_epoch: 1, host_pid: B_PID })
  if (input.record !== undefined) store.mutate(T1, fresh => ({ ...fresh, ...input.record }))
  let clock = 1_000_000
  const alive = new Set([A_PID, B_PID])
  const owner = fakeOwner(store, B_PID)
  owner.live.add(T1)
  const inbox = ControlInbox.for({ stateDir: store.stateDir, hostPid: B_PID, store, autoStart: false, now: () => clock })
  unregisters.push(inbox.register(owner, { channel: true, liveTasks: () => (input.advertise === false ? 0 : owner.live.size) }))
  const ownerTicks = { enabled: input.ownerTicks !== false }
  const channel = createRequesterChannel({ stateDir: store.stateDir, store, hostPid: A_PID, managerInstance: "requester-a",
    channel: input.channel !== false, isProcessAlive: pid => alive.has(pid), now: () => clock })
  const calls = { resumeLost: 0, pause: 0, finish: 0, endLost: 0, hold: 0 }
  const manager = {
    get: (taskId: string) => store.load(taskId) ?? undefined,
    list: () => store.list().records.map(record => ({ record })),
    pauseTask: async () => { calls.pause += 1; return { childSeq: 0 } },
    holdTaskInput: async (_taskId: string, entry: { inputId: string }) => { calls.hold += 1; return { kind: "held", entryId: entry.inputId, duplicate: false } },
    observeTaskHold: async () => undefined,
    resumePausedTask: async () => ({ turnId: "local-turn" }),
    resumeLostTask: async () => { calls.resumeLost += 1; return { turnId: "local-turn" } },
    cancelTask: async () => ({ kind: "noop", task_id: T1, status: "running", reason: "n/a" }),
    endLostPausedTask: () => { calls.endLost += 1; return true },
  } as unknown as TaskManager & TaskPauseMethods
  const wait = async (): Promise<void> => {
    clock += 100
    if (ownerTicks.enabled) await inbox.tick()
  }
  const barrier = new AdmissionBarrier()
  const runPause = createEngineRunPause({ stateDir: store.stateDir, barrier, manager,
    runtime: { getPauseState: () => undefined, fenceRun: () => undefined },
    remote: { channel, wait, now: () => clock, store, isProcessAlive: pid => alive.has(pid), armCancelWatcher: taskId => remoteCancel.arm(taskId) } })
  const remoteCancel = createRemoteCancel({ channel, store, holds: () => false, pauseSeq: parent => runPause.registry.load(parent)?.pauseSeq ?? 0,
    finish: async record => { calls.finish += 1; store.mutate(record.task_id, fresh => ({ ...fresh, status: "cancelled" })) }, now: () => clock })
  const carry = createGuidanceCarry({ channel, registry: runPause.registry })
  return {
    store, owner, inbox, channel, runPause, barrier, calls, alive, ownerTicks, carry, remoteCancel,
    advance: (ms: number) => { clock += ms },
    clock: () => clock,
    advertise: async () => { await inbox.tick() },
  }
}
