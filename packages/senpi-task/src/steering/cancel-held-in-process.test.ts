import { afterEach, describe, expect, test } from "bun:test"

import { createTaskLifecycle } from "../lifecycle/create"
import {
  cleanupProjects,
  FakeRegistry,
  seedRecord,
  settings,
  tempStore,
} from "../lifecycle/__fixtures__/lifecycle-fakes"
import { bounded, signal } from "../lifecycle/__fixtures__/live-parent-clock"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"
import { adaptInProcessHandle } from "../manager/child-handle"
import { DETACHED_CELL_WAITS, FINAL_RESULT } from "../runners/async-work.test-support"
import { heldWorkSession } from "../runners/in-process/__fixtures__/held-work-session"
import { createChildHandle, type RunnerOutcome } from "../runners/in-process/child-handle"
import { createManualSettlementScheduler, flushSettlement } from "../runners/rpc/turn-settlement.test-support"
import { createSteeringEngine } from "./engine"
import type { SteeringPort } from "./types"

afterEach(cleanupProjects)

const TASK = "st_00010487"

// The steering cancel over a REAL in-process child handle and the car's real async-work hold: the
// lifecycle destruction port tears the handle down, exactly as the manager wires it.
function heldChild() {
  const store = tempStore()
  const registry = new FakeRegistry()
  const session = heldWorkSession()
  const scheduler = createManualSettlementScheduler()
  const managed = adaptInProcessHandle(
    createChildHandle({
      taskId: TASK,
      session: session.session,
      promptText: "run the delayed eval, then answer FINAL-RESULT",
      asyncWork: { schedule: scheduler.scheduler, intervalMs: 1_000 },
    }),
  )
  let settled: RunnerOutcome | undefined
  void managed.waitForOutcome().then((outcome) => {
    settled = outcome
  })
  let aborts = 0
  registry.add({
    task_id: TASK,
    kind: "in-process",
    pid: undefined,
    abort: () => {
      aborts += 1
      return managed.abort()
    },
    dispose: () => managed.dispose(),
    terminate: async () => {},
  })
  seedRecord(store, { task_id: TASK, status: "running", residency_state: "resident", host_pid: process.pid })
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, registry, config: settings() })
  const destroyed: string[] = []
  const destroyedSignal = signal<undefined>()
  const port: SteeringPort = {
    store,
    liveHandle: (taskId) => (registry.get(taskId) === undefined ? undefined : managed),
    reserveForRevive: () => ({ ok: true, commit: () => undefined, release: () => undefined }),
    reviveDetached: async () => ({ ok: false, reason: "not used" }),
    dequeuePending: () => false,
    destruction: {
      destroyResidentTask: async (taskId, cause) => {
        destroyed.push(`${taskId}:${cause}`)
        await lifecycle.destroyResidentTask(taskId, cause)
        destroyedSignal.resolve(undefined)
      },
    },
    runStatsSnapshot: () => undefined,
    now: () => Date.parse("2026-11-27T00:00:00.000Z"),
  }
  return {
    store,
    session,
    scheduler,
    engine: createSteeringEngine(port),
    settled: () => settled,
    aborts: () => aborts,
    destroyed,
    whenDestroyed: destroyedSignal.promise,
    dispose: () => lifecycle.dispose?.(),
  }
}

describe("cancel of an in-process child whose turn is held on its own work (#10487, stack review 1)", () => {
  test("#given a held turn and no wake turn #when cancelled with the abort skipped #then the hold ends cancelled, the session is destroyed now and no turn starts afterwards", async () => {
    // given
    const h = heldChild()
    h.session.endTurnWithDetachedCell()
    await flushSettlement()
    expect(h.settled()).toBeUndefined()

    // when
    const outcome = await h.engine.cancelTask(TASK, "stop the run", { abort: "skip" })
    await flushSettlement()

    // then
    expect(outcome).toMatchObject({ kind: "cancelled", task_id: TASK })
    expect(h.settled()).toEqual({ status: "cancelled" })
    await bounded(h.whenDestroyed)
    expect(h.destroyed).toEqual([`${TASK}:cancel_without_abort`])
    expect(h.session.disposed()).toBe(true)
    expect(h.scheduler.pending()).toBe(0)
    h.session.finishWork()
    expect(h.session.agentStarts()).toBe(0)
    expect(h.store.load(TASK)?.status).toBe("cancelled")
    h.dispose()
  })

  test("#given a held turn whose work drained inside the wake-delivery grace #when cancelled with the abort skipped #then it ends cancelled at once and the session is destroyed now", async () => {
    // given - the work left the lifecycle and a confirmation read the session drained and idle
    const h = heldChild()
    h.session.endTurnWithDetachedCell()
    await flushSettlement()
    h.session.setWaits(undefined)
    h.scheduler.runNext()
    await flushSettlement()
    expect(h.settled()).toBeUndefined()

    // when
    const outcome = await h.engine.cancelTask(TASK, "stop the run", { abort: "skip" })
    await flushSettlement()

    // then
    expect(outcome).toMatchObject({ kind: "cancelled", task_id: TASK })
    expect(h.settled()).toEqual({ status: "cancelled" })
    await bounded(h.whenDestroyed)
    expect(h.destroyed).toEqual([`${TASK}:cancel_without_abort`])
    expect(h.session.disposed()).toBe(true)
    expect(h.scheduler.pending()).toBe(0)
    h.dispose()
  })

  test("#given a held turn whose wake turn is running #when cancelled with the abort skipped #then that turn reaches its end, no second hold is taken and the session is destroyed after it", async () => {
    // given
    const h = heldChild()
    h.session.endTurnWithDetachedCell()
    await flushSettlement()
    h.session.finishWork()
    expect(h.session.agentStarts()).toBe(1)

    // when
    const outcome = await h.engine.cancelTask(TASK, "stop the run", { abort: "skip" })
    await flushSettlement()

    // then - the running wake turn keeps the deferred teardown
    expect(outcome).toMatchObject({ kind: "cancelled", task_id: TASK })
    expect(h.settled()).toBeUndefined()
    expect(h.destroyed).toEqual([])
    expect(h.aborts()).toBe(0)

    // when - that turn ends leaving work pending again
    h.session.answer(FINAL_RESULT, DETACHED_CELL_WAITS)
    await flushSettlement()

    // then
    expect(h.settled()).toEqual({ status: "cancelled" })
    expect(h.scheduler.pending()).toBe(0)
    await bounded(h.whenDestroyed)
    expect(h.destroyed).toEqual([`${TASK}:cancel_without_abort`])
    expect(h.session.disposed()).toBe(true)
    expect(h.store.load(TASK)?.status).toBe("cancelled")
    expect(h.store.load(TASK)?.final_response).toBeUndefined()
    h.session.finishWork()
    expect(h.session.agentStarts()).toBe(1)
    h.dispose()
  })

  test("#given a held turn #when cancelled with the abort requested #then it ends cancelled and the session is destroyed", async () => {
    // given
    const h = heldChild()
    h.session.endTurnWithDetachedCell()
    await flushSettlement()

    // when
    const outcome = await h.engine.cancelTask(TASK, "stop")
    await flushSettlement()

    // then
    expect(outcome).toMatchObject({ kind: "cancelled", task_id: TASK })
    expect(h.settled()).toEqual({ status: "cancelled" })
    expect(h.destroyed).toEqual([`${TASK}:cancel`])
    expect(h.session.disposed()).toBe(true)
    h.session.finishWork()
    expect(h.session.agentStarts()).toBe(0)
    h.dispose()
  })

  test("#given an active turn that holds nothing #when cancelled with the abort skipped #then the turn is not aborted and the session is destroyed only at its end", async () => {
    // given - the prompted turn is still running
    const h = heldChild()
    h.session.setWaits(undefined)

    // when
    const outcome = await h.engine.cancelTask(TASK, "stop the run", { abort: "skip" })
    await flushSettlement()

    // then
    expect(outcome).toMatchObject({ kind: "cancelled", task_id: TASK })
    expect(h.aborts()).toBe(0)
    expect(h.destroyed).toEqual([])
    expect(h.session.disposed()).toBe(false)

    // when - the turn reaches its natural end
    h.session.endTurnWithDetachedCell()
    await bounded(h.whenDestroyed)

    // then
    expect(h.settled()?.status).toBe("completed")
    expect(h.destroyed).toEqual([`${TASK}:cancel_without_abort`])
    expect(h.session.disposed()).toBe(true)
    expect(h.store.load(TASK)?.status).toBe("cancelled")
    h.dispose()
  })
})
