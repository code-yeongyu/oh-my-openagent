import type { ManagedChildHandle } from "../../manager/child-handle"
import { createTaskLifecycle } from "../create"
import { hostLifecycleDeps, hostSession, hostSessionRecordInput } from "./host-session-fakes"
import { seedRecord, tempStore } from "./lifecycle-fakes"
import { expect } from "bun:test"

/** Every queued microtask has run: the fakes here resolve immediately and the store is synchronous. */
export const settled = () => new Promise<void>((resolve) => setImmediate(resolve))


export function harness(options: {
  host?: boolean
  capacity?: boolean
  succeeds?: boolean
  failure?: "model_unavailable" | "session_unavailable"
  lock?: boolean
  rollback?: boolean
  foreign?: boolean
  gateWait?: (ms: number) => Promise<void>
  respawnGate?: (attempt: number) => Promise<void>
  /** Reattach registers the live handle, as the manager's residency view does in production. */
  attachOnReattach?: boolean
} = {}) {
  const raw = tempStore()
  const taskId = "st_94980001"
  const events = new Map<string, ReturnType<typeof Promise.withResolvers<unknown>>>()
  const eventLog: string[] = []
  const event = (type: string) => {
    let signal = events.get(type)
    if (signal === undefined) {
      signal = Promise.withResolvers<unknown>()
      events.set(type, signal)
    }
    return signal.promise
  }
  // Subscribe before reconciliation; the real store still performs every state write.
  const revived = event("reconcile_reattached")
  const exhausted = event("revival_retry_exhausted")
  const lost = event("reconcile_lost")
  const suspended = event("suspended")
  const store = {
    ...raw,
    mutate: (id: string, mutation: Parameters<typeof raw.mutate>[1]) => raw.mutate(id, (fresh) => {
      const next = mutation(fresh)
      if (options.rollback && fresh.residency_state === "resident" && next.residency_state === "persisted_only") {
        throw new Error("rollback lock contended")
      }
      return next
    }),
    appendEvent: (id: string, input: { type: string; payload: unknown }) => {
      eventLog.push(`${id}:${input.type}`)
      const path = raw.appendEvent(id, input)
      events.get(input.type)?.resolve(input.payload)
      return path
    },
  }
  let attempts = 0
  let now = 0
  const fixture = hostLifecycleDeps({
    store,
    hostPid: 2222,
    isAlive: (pid) => options.foreign === true && pid === 4444,
    now: () => now,
    config: options.capacity ? { residency_max_children: 1 } : {},
    deferredRetryBackoffMs: [10, 20, 40],
    onWait: (ms) => { now += ms },
    ...(options.gateWait ? { gateWait: options.gateWait } : {}),
    respawn: async (record) => {
      attempts += 1
      await options.respawnGate?.(attempts)
      if (!options.succeeds || attempts === 1) {
        return { ok: false, disposition: "retryable", code: options.failure ?? "model_unavailable", reason: "temporarily unavailable" }
      }
      const handle: ManagedChildHandle = {
        task_id: record.task_id,
        sessionId: "child-session",
        pid: undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        abort: async () => undefined,
        subscribe: () => () => undefined,
        waitForOutcome: () => new Promise(() => undefined),
        lastAssistantText: () => undefined,
        dispose: async () => undefined,
      }
      return { ok: true, handle }
    },
  })
  seedRecord(store, {
    ...(options.host
      ? hostSessionRecordInput(taskId, hostSession(taskId))
      : { task_id: taskId, spawn_spec: { version: 1, cwd: "/tmp", prompt: "continue" } }),
    status: "running",
    residency_state: options.host ? "rpc_detached" : "persisted_only",
    notify_on_terminal: true,
    ...(options.foreign ? { host_pid: 4444 } : {}),
  })
  if (options.capacity) {
    seedRecord(store, { task_id: "st_94980002", status: "running", host_pid: 2222 })
    fixture.registry.add({
      task_id: "st_94980002", kind: "in-process", pid: undefined,
      abort: async () => undefined, dispose: async () => undefined, terminate: async () => undefined,
    })
  }
  const lifecycle = createTaskLifecycle({
    ...fixture.deps,
    ...(options.attachOnReattach
      ? {
          reattach: async (record: { task_id: string }) => {
            fixture.registry.add({
              task_id: record.task_id, kind: "in-process", pid: undefined,
              abort: async () => undefined, dispose: async () => undefined, terminate: async () => undefined,
            })
            return { ok: true as const }
          },
        }
      : {}),
    ...(options.lock ? { reconcileAdmission: { acquireLease: async () => ({ kind: "contended" as const }) } } : {}),
  })
  return { store, taskId, fixture, lifecycle, revived, exhausted, lost, suspended, eventLog, attempts: () => attempts }
}

export async function resume(h: ReturnType<typeof harness>) {
  const result = await h.lifecycle.reconcileOnSessionStart("parent-1")
  // The clock must be armed by this session_start, not by a later session or a real timer.
  expect(h.fixture.waits.length).toBeGreaterThan(0)
  return result
}

