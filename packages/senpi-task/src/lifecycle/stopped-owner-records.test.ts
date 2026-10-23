import { afterEach, describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { TaskRecordStore } from "../store"
import type { TaskStatus } from "../state"
import { createTaskLifecycle } from "./create"
import {
  cleanupProjects, FakeRegistry, fakeHandle, readEvents, seedRecord, settings, tempStore, type CallLog,
} from "./__fixtures__/lifecycle-fakes"
import { NO_HOST_ENDPOINT } from "./host-session"

afterEach(() => cleanupProjects())

const PARENT_SESSION = "parent-1"
const CHILD = "st_000000c1"

type AfterSnapshot = (store: TaskRecordStore) => void

function stoppedOwnerWorld(child: {
  status: TaskStatus; live: boolean; queued?: number
  // Runs between the shutdown's list() snapshot and its writes: the store moves on, the snapshot does not.
  afterSnapshot?: AfterSnapshot
  // Runs when the shutdown dequeues the pending child: a launch admitting it right then.
  onDequeue?: (store: TaskRecordStore, registry: FakeRegistry, order: CallLog) => void
  // Runs right after the cancel transition lands, before the queue is cleared: a send arriving then.
  afterCancel?: AfterSnapshot
}) {
  const store = tempStore()
  seedRecord(store, {
    task_id: "st_000000b0", parent_session_id: "root-1", status: "cancelled",
    execution_mode: "process", child_session_id: PARENT_SESSION, host_pid: process.pid,
  })
  seedRecord(store, {
    task_id: CHILD, parent_session_id: PARENT_SESSION, status: child.status, execution_mode: "in-process",
    residency_state: "resident", host_pid: process.pid,
  })
  if ((child.queued ?? 0) > 0) {
    store.mutate(CHILD, (record) => ({
      ...record,
      pending_steering: Array.from({ length: child.queued ?? 0 }, (_, index) => ({
        id: `q${index}`, message: `queued ${index}`, deliver_as: "followUp" as const,
      })),
    }))
  }
  const order: CallLog = []
  const registry = new FakeRegistry()
  if (child.live) registry.add(fakeHandle(CHILD, "in-process", order))
  const dequeued: string[] = []
  const snapshot = store.list()
  child.afterSnapshot?.(store)
  const viewedStore = child.afterSnapshot !== undefined || child.afterCancel !== undefined
    ? new Proxy(store, {
      get: (target, key) => {
        if (key === "list" && child.afterSnapshot !== undefined) return () => snapshot
        if (key === "transition" && child.afterCancel !== undefined) {
          const afterCancel = child.afterCancel
          return (...args: Parameters<TaskRecordStore["transition"]>) => {
            const result = target.transition(...args)
            if (args[1].type === "cancel") afterCancel(target)
            return result
          }
        }
        const value: unknown = Reflect.get(target, key)
        return typeof value === "function" ? value.bind(target) : value
      },
    })
    : store
  const lifecycle = createTaskLifecycle({
    hostEndpoint: NO_HOST_ENDPOINT, store: viewedStore, registry, config: settings(),
    dequeuePending: (taskId) => {
      dequeued.push(taskId)
      child.onDequeue?.(store, registry, order)
    },
  })
  return { store, order, dequeued, lifecycle }
}

function steerDroppedCounts(store: TaskRecordStore): number[] {
  return readFileSync(join(store.stateDir, "logs", `${CHILD}.jsonl`), "utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as { type: string; payload?: { count?: number } })
    .filter((event) => event.type === "steer_dropped")
    .map((event) => event.payload?.count ?? -1)
}

describe("stopped owner's children at the record level", () => {
  test("#given a pending child with no handle #when the stopped owner's session shuts down #then it is dequeued and cancelled, never parked to relaunch", async () => {
    const { store, dequeued, lifecycle } = stoppedOwnerWorld({ status: "pending", live: false })

    const summary = await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    expect(dequeued).toEqual([CHILD])
    expect(store.load(CHILD)?.status).toBe("cancelled")
    expect(readEvents(store, CHILD)).toContain("cancelled")
    expect(summary.suspended_pending).toBe(0)
    expect(summary.disposed).toBe(1)
  })

  test("#given a child that already settled on its own #when the stopped owner's session shuts down #then it keeps its outcome and no cancelled event is written", async () => {
    const { store, order, lifecycle } = stoppedOwnerWorld({
      status: "running", live: true,
      afterSnapshot: (store) => {
        store.transition(CHILD, { type: "complete", timestamp: new Date().toISOString(), final_response: "done on its own" })
      },
    })

    await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    expect(store.load(CHILD)?.status).toBe("completed")
    expect(readEvents(store, CHILD)).not.toContain("cancelled")
    expect(order).toContain(`dispose:${CHILD}`)
  })

  test("#given a running child with queued steering #when the stopped owner's session shuts down #then the queue is dropped with a record of how many", async () => {
    const { store, lifecycle } = stoppedOwnerWorld({ status: "running", live: true, queued: 2 })

    await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    const record = store.load(CHILD)
    expect(record?.status).toBe("cancelled")
    expect(record?.pending_steering).toBeUndefined()
    expect(readEvents(store, CHILD)).toEqual(expect.arrayContaining(["steer_dropped", "cancelled"]))
  })

  // #10866: a message queued between the cancel's read and the mutate that clears the queue is dropped
  // too, so the cancel message and the steer_dropped event must both count it.
  test("#given a message queued right after the cancel lands #when the stopped owner's session shuts down #then the cancel message and steer_dropped count the same dropped messages", async () => {
    const { store, lifecycle } = stoppedOwnerWorld({
      status: "running", live: true, queued: 2,
      afterCancel: (current) => {
        current.mutate(CHILD, (fresh) => ({
          ...fresh,
          pending_steering: [...(fresh.pending_steering ?? []), { id: "late", message: "late", deliver_as: "followUp" as const }],
        }))
      },
    })

    await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    expect(store.load(CHILD)?.error_message).toContain("3 queued messages were not delivered.")
    expect(steerDroppedCounts(store)).toEqual([3])
  })

  test("#given a launch admits the pending child while it is being dequeued #when the stopped owner's session shuts down #then the now-live child is marked stopping", async () => {
    const { store, order, lifecycle } = stoppedOwnerWorld({
      status: "pending", live: false,
      onDequeue: (current, registry, calls) => {
        current.transition(CHILD, { type: "start", timestamp: new Date().toISOString() })
        registry.add({ ...fakeHandle(CHILD, "in-process", calls), markStopping: () => calls.push(`markStopping:${CHILD}`) })
      },
    })

    await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    expect(store.load(CHILD)?.status).toBe("cancelled")
    expect(order).toContain(`markStopping:${CHILD}`)
  })

  test("#given a message is queued after the shutdown's snapshot #when the stopped owner's session shuts down #then that queue is dropped too", async () => {
    const { store, lifecycle } = stoppedOwnerWorld({
      status: "running", live: true,
      afterSnapshot: (current) => {
        current.mutate(CHILD, (record) => ({ ...record, pending_steering: [{ id: "late", message: "late", deliver_as: "followUp" as const }] }))
      },
    })

    await lifecycle.suspendOnSessionShutdown({ parentSessionId: PARENT_SESSION, reason: "quit" })

    expect(store.load(CHILD)?.pending_steering).toBeUndefined()
    expect(readEvents(store, CHILD)).toContain("steer_dropped")
  })
})
