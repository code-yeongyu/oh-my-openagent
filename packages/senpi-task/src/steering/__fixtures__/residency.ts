import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createTaskRecord, type TaskRecord } from "../../state"
import type { createTaskRecordStore } from "../../store"
import type { ManagedChildHandle } from "../../manager/child-handle"
import type { RpcChildHandle } from "../../runners/types"
import type { SteeringPort } from "../types"

export const roots: string[] = []
export function cleanupRoots() {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
}

export function detachedTerminal(store: ReturnType<typeof createTaskRecordStore>): TaskRecord {
  const record = createTaskRecord({
    parent_session_id: "parent",
    root_session_id: "parent",
    depth: 1,
    execution_mode: "process",
    model: "anthropic/claude",
    notify_on_terminal: false,
  })
  const terminal: TaskRecord = {
    ...record,
    task_id: "st_75500009",
    status: "completed",
    residency_state: "rpc_detached",
    final_response: "first pass",
    spawn_spec: { cwd: store.stateDir },
    terminal_at: "2026-09-01T00:00:00.000Z",
  }
  store.save(terminal)
  const sessionDir = join(store.stateDir, "children", terminal.task_id, "sessions", terminal.task_id)
  mkdirSync(sessionDir, { recursive: true })
  writeFileSync(join(sessionDir, "resume.jsonl"), "{\"role\":\"assistant\"}\n")
  return terminal
}

export function fakeHandle(taskId: string, followUps: string[]): ManagedChildHandle {
  return {
    task_id: taskId,
    sessionId: `session:${taskId}`,
    pid: 7000,
    steer: async () => undefined,
    followUp: async (message) => { followUps.push(message) },
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
  }
}

export function rpcHandle(taskId: string, followUps: string[]): RpcChildHandle {
  return {
    task_id: taskId,
    sessionId: `session:${taskId}`,
    pid: 7000,
    steer: async () => undefined,
    followUp: async (message) => { followUps.push(message) },
    abort: async () => undefined,
    subscribe: () => () => undefined,
    waitForIdle: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
    terminate: async () => undefined,
    exitOutcome: () => undefined,
    waitForExit: async () => ({ kind: "clean", facts: { pid: 7000, code: 0, signal: null, stderrTail: "" } }),
    lastSeen: () => undefined,
    switchSession: async () => ({ cancelled: false }),
  }
}

export function portFor(
  store: ReturnType<typeof createTaskRecordStore>,
  revived: ManagedChildHandle | undefined,
  reviveReasons: string[],
  startLive = false,
): SteeringPort {
  let live = startLive
  return {
    store,
    liveHandle: () => live ? revived : undefined,
    reserveForRevive: () => ({
      ok: true,
      commit: () => undefined,
      release: () => undefined,
    }),
    reviveDetached: async (taskId) => {
      if (revived === undefined) {
        reviveReasons.push("respawn failed")
        return { ok: false, reason: "respawn failed" }
      }
      live = true
      store.mutate(taskId, (record) => ({ ...record, residency_state: "resident", host_pid: 6000 }))
      reviveReasons.push("revived")
      return { ok: true }
    },
    dequeuePending: () => false,
    destruction: { destroyResidentTask: async () => undefined },
    runStatsSnapshot: () => undefined,
    now: () => Date.parse("2026-09-02T00:00:00.000Z"),
  }
}

export function storeLoad(store: ReturnType<typeof createTaskRecordStore>, taskId: string): TaskRecord | null {
  return store.load(taskId)
}
