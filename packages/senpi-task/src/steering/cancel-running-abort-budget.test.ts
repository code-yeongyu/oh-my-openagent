import { afterEach, describe, expect, test } from "bun:test"
import { EventEmitter, once } from "node:events"

import { cleanupProjects, seedRecord, tempStore } from "../lifecycle/__fixtures__/lifecycle-fakes"
import type { TeardownStep } from "../lifecycle/teardown-budget"
import type { ManagedChildHandle } from "../manager/child-handle"
import type { TaskRecordStore } from "../store"
import { createSteeringEngine } from "./engine"
import type { SteeringPort } from "./types"

afterEach(cleanupProjects)

const TASK = "st_00009791"

// A running child whose abort is never answered: the case that held task_cancel forever (omo#9791).
function deafChild(calls: string[]): ManagedChildHandle {
  return {
    task_id: TASK,
    sessionId: `session:${TASK}`,
    pid: 999_999_999,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: () => {
      calls.push("abort")
      return new Promise<void>(() => undefined)
    },
    subscribe: () => () => undefined,
    waitForOutcome: () => new Promise(() => undefined),
    lastAssistantText: () => undefined,
    dispose: async () => undefined,
  }
}

// The abort budget expires only when the test says so: no wall-clock waits.
function manualDeadline() {
  const waiting: (() => void)[] = []
  const armed = new EventEmitter()
  return {
    deadline: (_step: TeardownStep) => new Promise<void>((resolve) => {
      waiting.push(resolve)
      armed.emit("armed")
    }),
    armed: () => once(armed, "armed", { signal: AbortSignal.timeout(3_000) }),
    expire: () => { for (const resolve of waiting.splice(0)) resolve() },
  }
}

function steeringFor(store: TaskRecordStore, handle: ManagedChildHandle, deadline: ManualDeadline, destroyed: string[]) {
  const port: SteeringPort = {
    store,
    liveHandle: () => handle,
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    reviveDetached: async () => ({ ok: false, reason: "not used" }),
    dequeuePending: () => false,
    destruction: { destroyResidentTask: async (taskId, cause) => { destroyed.push(`${taskId}:${cause}`) } },
    runStatsSnapshot: () => undefined,
    abortDeadline: deadline.deadline,
    now: () => Date.parse("2026-10-09T00:00:00.000Z"),
  }
  return createSteeringEngine(port)
}

type ManualDeadline = ReturnType<typeof manualDeadline>

describe("task_cancel and interrupt on a running child that never answers its abort (omo#9791)", () => {
  test("#given a running child that ignores abort #when cancelled #then once the abort budget expires the child is destroyed and the cancel completes", async () => {
    // given
    const store = tempStore()
    const calls: string[] = []
    const destroyed: string[] = []
    seedRecord(store, { task_id: TASK, status: "running", residency_state: "resident", host_pid: process.pid })
    const deadline = manualDeadline()
    const engine = steeringFor(store, deafChild(calls), deadline, destroyed)

    // when
    const armed = deadline.armed()
    const cancel = engine.cancelTask(TASK, "no longer needed")
    await armed
    deadline.expire()
    const outcome = await cancel

    // then
    expect(outcome).toEqual({ kind: "cancelled", task_id: TASK, previous_status: "running" })
    expect(calls).toEqual(["abort"])
    expect(destroyed).toEqual([`${TASK}:cancel`])
    expect(store.load(TASK)?.status).toBe("cancelled")
  })

  test("#given a running child that ignores abort #when interrupted #then once the abort budget expires the interrupt completes", async () => {
    // given
    const store = tempStore()
    seedRecord(store, { task_id: TASK, status: "running", residency_state: "resident", host_pid: process.pid })
    const deadline = manualDeadline()
    const engine = steeringFor(store, deafChild([]), deadline, [])

    // when
    const armed = deadline.armed()
    const interrupt = engine.interruptTask(TASK)
    await armed
    deadline.expire()
    const outcome = await interrupt

    // then
    expect(outcome).toEqual({ kind: "interrupted", task_id: TASK, previous_status: "running" })
    expect(store.load(TASK)?.status).toBe("interrupted")
  })
})
