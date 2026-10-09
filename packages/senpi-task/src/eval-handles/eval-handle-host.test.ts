import { afterEach, describe, expect, test } from "bun:test"
import type { EvalHandleHost, HandleRef, HandleSnapshot, HandleWatch } from "@code-yeongyu/senpi"

import type { ManagedChildHandle } from "../manager/child-handle"
import type { SendOutcome } from "../steering/types"
import { FakeRunner, baseSpec, cleanupProjects, flush, makeManager } from "../manager/__fixtures__/manager-fakes"
import type { ManagedStartSpec } from "../manager/types"
import { SEND_HOST_STATUS } from "./run-after-engine"
import { WATCH_HOST_STATUS } from "./watch"
import { createEvalHandleHost } from "./host"
import { fixture as poolFixture, poolInput } from "../workpool/__fixtures__/admission"

afterEach(cleanupProjects)

const OWNER = { ownerSessionId: "parent-1" }
const NO_POOLS = {
  inspect: () => { throw new Error("no pools in this test") },
  cancel: () => { throw new Error("no pools in this test") },
  subscribe: () => () => undefined,
}

async function harness() {
  const inProcess = new FakeRunner()
  const { manager, store } = makeManager({ inProcess })
  const host = createEvalHandleHost({ tasks: manager, workpools: NO_POOLS, poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }), stateDir: store.stateDir })
  const started = await manager.start(baseSpec())
  if (started.kind !== "started") throw new Error("expected a started child")
  const ref: HandleRef = { kind: "agent", id: started.task_id, run_epoch: 0 }
  const settle = async (finalResponse: string): Promise<void> => {
    inProcess.handles.get(started.task_id)?.settle({ status: "completed", finalResponse })
    await flush()
  }
  return { host, manager, store, ref, settle }
}

class StartObservingRunner extends FakeRunner {
  readonly #waiters: Array<() => void> = []

  override start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const started = super.start(spec)
    this.#waiters.shift()?.()
    return started
  }

  nextStart(): Promise<void> {
    return new Promise((resolve) => { this.#waiters.push(resolve) })
  }
}

function fallbackPlanner() {
  const model = (provider: string, id: string) => ({ source: "category" as const, provider, model_id: id, display: `${provider}/${id}` })
  return () => ({
    kind: "resolved" as const,
    plan: { model: "vendor-a/primary", requested_model: model("vendor-a", "primary"), resolved_model: model("vendor-a", "primary"), fallback_models: [model("vendor-b", "next")], category: "quick" },
  })
}

async function phaseOf(host: EvalHandleHost, ref: HandleRef, owner: { readonly ownerSessionId: string }): Promise<string | undefined> {
  const watch = await host.watch([ref], owner)
  watch.close()
  return watch.initial[0]?.phase
}

async function drain(watch: HandleWatch): Promise<HandleSnapshot[]> {
  const seen: HandleSnapshot[] = []
  for await (const snapshot of watch.updates) seen.push(snapshot)
  return seen
}

describe("EvalHandleHost over real task children", () => {
  test("a watched agent run that finishes arrives exactly once and its result is the task's final text", async () => {
    const { host, ref, settle } = await harness()
    const watch = await host.watch([ref], OWNER)
    expect(watch.initial.map((s) => s.phase)).toEqual(["pending"])

    const updates = drain(watch)
    await settle("both values")
    watch.close()

    expect((await updates).map((s) => [s.phase, s.ref.run_epoch])).toEqual([["succeeded", 0]])
    expect(await host.result(ref, OWNER)).toEqual({ status: "fulfilled", ref, value: "both values" })
  })

  test("two agent runs finishing out of order are each reported once and their results come back in the caller's order", async () => {
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const host = createEvalHandleHost({ tasks: manager, workpools: NO_POOLS, poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }), stateDir: store.stateDir })
    const a = await manager.start(baseSpec())
    const b = await manager.start(baseSpec())
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected two started children")
    const refs: HandleRef[] = [{ kind: "agent", id: a.task_id, run_epoch: 0 }, { kind: "agent", id: b.task_id, run_epoch: 0 }]
    const watch = await host.watch(refs, OWNER)
    const updates = drain(watch)

    inProcess.handles.get(b.task_id)?.settle({ status: "completed", finalResponse: "value b" })
    await flush()
    inProcess.handles.get(a.task_id)?.settle({ status: "completed", finalResponse: "value a" })
    await flush()
    watch.close()

    expect((await updates).map((s) => s.ref.id)).toEqual([b.task_id, a.task_id])
    const values = await Promise.all(refs.map(async (ref) => (await host.result(ref, OWNER)) as { value: unknown }))
    expect(values.map((outcome) => outcome.value)).toEqual(["value a", "value b"])
  })

  test("a run that already finished before the watch shows up once, in initial, with no update", async () => {
    const { host, ref, settle } = await harness()
    await settle("done early")

    const watch = await host.watch([ref], OWNER)
    const updates = drain(watch)
    watch.close()

    expect(watch.initial.map((s) => s.phase)).toEqual(["succeeded"])
    expect(await updates).toEqual([])
  })

  test("a runtime model fallback moves the epoch inside the same run: the handle stays live and the fallback's result arrives", async () => {
    const runner = new StartObservingRunner()
    const { manager, store } = makeManager({ inProcess: runner, planner: fallbackPlanner() })
    const host = createEvalHandleHost({ tasks: manager, workpools: NO_POOLS, poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }), stateDir: store.stateDir })
    const firstStart = runner.nextStart()
    const started = await manager.start(baseSpec({ execution_mode: "in-process" }))
    if (started.kind !== "started") throw new Error("expected a started child")
    await firstStart
    const ref: HandleRef = { kind: "agent", id: started.task_id, run_epoch: 0 }
    const watch = await host.watch([ref], OWNER)
    const updates = drain(watch)

    const fallbackStart = runner.nextStart()
    runner.handles.get(started.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "provider capacity exhausted" } })
    await fallbackStart
    expect(store.load(started.task_id)?.notification.run_epoch).toBeGreaterThan(0)
    expect(await host.cancel(ref, OWNER)).toMatchObject({ cancelled: true, phase: "cancelled" })

    watch.close()
    expect((await updates).map((s) => s.phase)).toEqual(["cancelled"])
  })

  test("a send to a finished agent revives it as a new run: the caller gets the new ref, told so, and the old ref goes stale", async () => {
    const { host, ref, settle } = await harness()
    await settle("first pass")

    const revived = await host.send(ref, "second pass", OWNER)

    expect(revived.ref.run_epoch).toBe(1)
    expect(revived.host_status).toBe("revived as epoch 1")
    expect(revived.phase).toBe("pending")
    await expect(host.result(ref, OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })
    const watch = await host.watch([revived.ref], OWNER)
    const updates = drain(watch)
    await settle("second result")
    watch.close()
    expect((await updates).map((s) => [s.phase, s.ref.run_epoch])).toEqual([["succeeded", 1]])
    expect(await host.result(revived.ref, OWNER)).toMatchObject({ status: "fulfilled", value: "second result" })
  })

  test("cancelling a stale handle is refused and the successor run keeps running", async () => {
    const { host, store, ref, settle } = await harness()
    await settle("first pass")
    await host.send(ref, "second pass", OWNER)

    await expect(host.cancel(ref, OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })

    expect(store.load(ref.id)?.status).toBe("running")
  })

  test("a revive landing between the handle's check and the cancel is caught inside the task engine", async () => {
    const { host, manager, store, ref, settle } = await harness()
    await settle("first pass")
    const racing = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        sendToTask: (input) => manager.sendToTask(input),
        cancelTask: async (id, reason, options) => {
          await manager.sendToTask({ idOrName: id, message: "revived in the gap", callerSessionId: OWNER.ownerSessionId })
          return manager.cancelTask(id, reason, options)
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    await expect(racing.cancel(ref, OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })
    expect(store.load(ref.id)?.status).toBe("running")
    expect(store.load(ref.id)?.notification.run_epoch).toBe(1)
    await expect(host.result({ ...ref, run_epoch: 1 }, OWNER)).rejects.toMatchObject({ code: "eval_handle_pending" })
  })

  test("the cancel transition itself refuses a run that moved after the caller read it, under the record lock", async () => {
    const { host, store, ref, settle } = await harness()
    await settle("first pass")
    await host.send(ref, "second pass", OWNER)

    const result = store.transition(ref.id, { type: "cancel", timestamp: new Date().toISOString(), expected_run_epoch: ref.run_epoch })

    expect(result.applied).toBe(false)
    expect(result.audit).toEqual({ type: "epoch_mismatch_ignored", expected_run_epoch: 0, run_epoch: 1 })
    expect(store.load(ref.id)?.status).toBe("running")
  })

  test("cancelling a live run cancels it; cancelling it again reports it already ended", async () => {
    const { host, store, ref } = await harness()

    expect(await host.cancel(ref, OWNER)).toMatchObject({ cancelled: true, phase: "cancelled" })
    expect(store.load(ref.id)?.status).toBe("cancelled")
    expect(await host.cancel(ref, OWNER)).toMatchObject({ cancelled: false, phase: "cancelled" })
  })

  test("a handle from before the upgrade whose task moved epoch is stale and says to re-fetch it", async () => {
    const { host, store, ref } = await harness()
    store.mutate(ref.id, (record) => {
      const { run_start_epoch: _legacy, ...rest } = record
      return { ...rest, notification: { ...record.notification, run_epoch: 1 } }
    })

    await expect(host.result(ref, OWNER)).rejects.toThrow(/handle from before the upgrade.*re-fetch it/)
  })

  test("another session's task is forbidden and an unknown task is not found", async () => {
    const { host, ref } = await harness()

    await expect(host.watch([ref], { ownerSessionId: "someone-else" })).rejects.toMatchObject({ code: "eval_handle_forbidden" })
    await expect(host.result({ ...ref, id: "st_0000000000000000000000000" }, OWNER)).rejects.toMatchObject({ code: "eval_handle_not_found" })
  })

  test("a resume during an output read yields eval_handle_stale, never the successor's transcript", async () => {
    const { manager, store, ref, settle } = await harness()
    await settle("first pass")
    const host = createEvalHandleHost({
      tasks: manager,
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
      transcriptReader: () => {
        store.mutate(ref.id, (record) => ({ ...record, status: "running", run_start_epoch: 1, notification: { ...record.notification, run_epoch: 1 } }))
        return { entries: [{ kind: "assistant", text: "successor text" }], source: "event-log" }
      },
    })

    await expect(host.output(ref, { format: "raw" }, OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })
  })

  test("the task engine names a moved run as stale, for both send and cancel, instead of a reason string", async () => {
    const { manager, ref, settle } = await harness()
    await settle("first pass")
    await manager.sendToTask({ idOrName: ref.id, message: "second pass", callerSessionId: OWNER.ownerSessionId })

    const cancel = await manager.cancelTask(ref.id, "from an old handle", { expectedRunEpoch: 0 })
    const send = await manager.sendToTask({ idOrName: ref.id, message: "from an old handle", callerSessionId: OWNER.ownerSessionId, expectedRunEpoch: 0 })

    expect(cancel).toMatchObject({ kind: "stale", task_id: ref.id, run_epoch: 1 })
    expect(send).toMatchObject({ kind: "stale", task_id: ref.id, run_epoch: 1 })
    expect(manager.get(ref.id)?.status).toBe("running")
  })

  test("a send whose message lands as the run settles says the run ended, rather than reporting a plain finished run", async () => {
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected a started child")
    const ref: HandleRef = { kind: "agent", id: started.task_id, run_epoch: 0 }
    const racing = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
        sendToTask: async (input) => {
          const outcome = await manager.sendToTask(input)
          inProcess.handles.get(ref.id)?.settle({ status: "completed", finalResponse: "settled during the send" })
          await flush()
          return outcome
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    const reply = await racing.send(ref, "one more thing", OWNER)

    expect(reply.phase).toBe("succeeded")
    expect(reply.ref.run_epoch).toBe(0)
    expect(reply.host_status).toBe(SEND_HOST_STATUS.deliveredAfterEnd)
  })

  test("a cancel the engine answers as already ended, with a revive landing before the re-read, is stale rather than the next run's state", async () => {
    const { manager, store, ref, settle } = await harness()
    await settle("first pass")
    const racing = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        sendToTask: (input) => manager.sendToTask(input),
        cancelTask: async (id, reason, options) => {
          const outcome = await manager.cancelTask(id, reason, options)
          await manager.sendToTask({ idOrName: id, message: "revived after the cancel", callerSessionId: OWNER.ownerSessionId })
          return outcome
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    await expect(racing.cancel(ref, OWNER)).rejects.toMatchObject({ code: "eval_handle_stale" })
    expect(store.load(ref.id)?.status).toBe("running")
  })

  test("a send whose child starts a follow-up turn before the re-read hands back the new run's ref and says it continued", async () => {
    const inProcess = new FakeRunner()
    const { manager, store } = makeManager({ inProcess })
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected a started child")
    const ref: HandleRef = { kind: "agent", id: started.task_id, run_epoch: 0 }
    const racing = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
        sendToTask: async (input) => {
          const outcome = await manager.sendToTask(input)
          inProcess.handles.get(ref.id)?.settle({ status: "completed", finalResponse: "first run" })
          await flush()
          inProcess.handles.get(ref.id)?.selfResume()
          await flush()
          return outcome
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    const reply = await racing.send(ref, "and then this", OWNER)
    const current = store.load(ref.id)?.notification.run_epoch

    expect(current ?? -1).toBeGreaterThan(0)
    expect(reply.ref.run_epoch).toBe(current ?? -1)
    expect(reply.phase).toBe("pending")
    expect(reply.host_status).toBe(`continued as epoch ${current}`)
  })

  test("a settle that lands between the watch's subscription and its first read is seen exactly once, in initial", async () => {
    const { manager, store, ref } = await harness()
    const host = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
        sendToTask: (input) => manager.sendToTask(input),
        // The barrier: the run settles after the waiter is registered and before the initial snapshot is read,
        // and the waiter then delivers that same terminal record.
        waitFor: (id) => {
          store.transition(id, { type: "complete", timestamp: new Date().toISOString(), final_response: "settled mid-setup" })
          const terminal = store.load(id)
          return terminal === null ? Promise.reject(new Error("missing record")) : Promise.resolve(terminal)
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    const watch = await host.watch([ref], OWNER)
    const updates = drain(watch)
    await flush()
    watch.close()

    expect(watch.initial.map((s) => s.phase)).toEqual(["succeeded"])
    expect(await updates).toEqual([])
  })

  test("a watch whose run is rolled back ends as lost when the waiter settles with the earlier run, instead of waiting out its timeout", async () => {
    const { manager, store, ref, settle } = await harness()
    await settle("first pass")
    const revived = await manager.sendToTask({ idOrName: ref.id, message: "second pass", callerSessionId: OWNER.ownerSessionId })
    if (revived.kind !== "revived") throw new Error("expected a revive")
    const successor: HandleRef = { ...ref, run_epoch: revived.run_epoch }
    let rollBack: () => void = () => undefined
    const host = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
        sendToTask: (input) => manager.sendToTask(input),
        waitFor: (id) => new Promise((resolve) => {
          rollBack = () => {
            store.mutate(id, (record) => ({ ...record, status: "completed", run_start_epoch: 0, notification: { ...record.notification, run_epoch: 0 } }))
            const restored = store.load(id)
            if (restored !== null) resolve(restored)
          }
        }),
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })
    const watch = await host.watch([successor], OWNER)
    const updates = drain(watch)

    rollBack()
    await flush()
    watch.close()

    expect((await updates).map((s) => [s.phase, s.host_status])).toEqual([["lost", WATCH_HOST_STATUS.runGone]])
    await expect(host.result(successor, OWNER)).rejects.toMatchObject({ code: "eval_handle_not_found" })
  })

  test("a watch on a pre-upgrade record still delivers its terminal after an in-run epoch move, and the result names the re-fetch", async () => {
    const runner = new StartObservingRunner()
    const { manager, store } = makeManager({ inProcess: runner, planner: fallbackPlanner() })
    const host = createEvalHandleHost({ tasks: manager, workpools: NO_POOLS, poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }), stateDir: store.stateDir })
    const firstStart = runner.nextStart()
    const started = await manager.start(baseSpec({ execution_mode: "in-process" }))
    if (started.kind !== "started") throw new Error("expected a started child")
    await firstStart
    store.mutate(started.task_id, (record) => {
      const { run_start_epoch: _legacy, ...rest } = record
      return rest
    })
    const ref: HandleRef = { kind: "agent", id: started.task_id, run_epoch: 0 }
    const watch = await host.watch([ref], OWNER)
    const updates = drain(watch)

    const fallbackStart = runner.nextStart()
    runner.handles.get(started.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "provider capacity exhausted" } })
    await fallbackStart
    const terminal = manager.waitFor(started.task_id, { signal: AbortSignal.timeout(5000) })
    await manager.cancelTask(started.task_id, "end the fallback run")
    await terminal
    watch.close()

    expect((await updates).map((s) => s.phase)).toEqual(["cancelled"])
    await expect(host.result(ref, OWNER)).rejects.toThrow(/handle from before the upgrade.*re-fetch it/)
  })

  test("each status read leaves no abort listener behind on the cell's signal", async () => {
    const { host, ref } = await harness()
    const signal = new AbortController().signal
    const added: unknown[] = []
    const removed: unknown[] = []
    const add = signal.addEventListener.bind(signal)
    const remove = signal.removeEventListener.bind(signal)
    signal.addEventListener = ((type: string, listener: EventListener, options?: AddEventListenerOptions) => {
      added.push(listener)
      add(type, listener, options)
    }) as typeof signal.addEventListener
    signal.removeEventListener = ((type: string, listener: EventListener) => {
      removed.push(listener)
      remove(type, listener)
    }) as typeof signal.removeEventListener

    for (let index = 0; index < 5; index += 1) (await host.watch([ref], { ...OWNER, signal })).close()

    expect(added).toHaveLength(5)
    expect(removed).toEqual(added)
  })
})

describe("EvalHandleHost over a real workpool", () => {
  function pools() {
    const f = poolFixture()
    const host = createEvalHandleHost({
      tasks: f.manager,
      workpools: f.manager.workpools,
      poolCaller: (sessionId) => ({ ...f.caller, sessionId }),
      stateDir: f.store.stateDir,
    })
    const pool = f.manager.workpools.create(f.caller, poolInput)
    const ref: HandleRef = { kind: "workpool", id: pool.pool_id, run_epoch: 0 }
    return { f, host, ref, owner: { ownerSessionId: f.caller.sessionId } }
  }

  test("an open pool is pending; once closed with nothing queued it settles and its result is the item list", async () => {
    const { f, host, ref, owner } = pools()
    expect(await phaseOf(host, ref, owner)).toBe("pending")

    f.manager.workpools.close(f.caller, ref.id)

    expect(await phaseOf(host, ref, owner)).toBe("succeeded")
    expect(await host.result(ref, owner)).toEqual({ status: "fulfilled", ref, value: [] })
  })

  test("cancelling a pool through its handle cancels it, and the result reports the cancellation", async () => {
    const { host, ref, owner } = pools()

    expect(await host.cancel(ref, owner)).toMatchObject({ cancelled: true, phase: "cancelled" })

    expect(await host.result(ref, owner)).toMatchObject({ status: "rejected", error: { code: "eval_handle_cancelled" } })
  })

  test("another session's pool is forbidden", async () => {
    const { host, ref } = pools()

    await expect(host.watch([ref], { ownerSessionId: "someone-else" })).rejects.toMatchObject({ code: "eval_handle_forbidden" })
  })
})

describe("every send and cancel reply is checked against the run after the engine returns", () => {
  type Interleave = (input: { readonly store: ReturnType<typeof makeManager>["store"]; readonly taskId: string; readonly epoch: number }) => void
  const startFollowUpRun: Interleave = ({ store, taskId, epoch }) => {
    store.mutate(taskId, (record) => ({ ...record, status: "running", run_start_epoch: epoch, notification: { ...record.notification, run_epoch: epoch } }))
  }

  async function racingHost(sendOutcome: (input: { readonly taskId: string }) => Promise<SendOutcome>, moveTo: number, interleave: Interleave = startFollowUpRun) {
    const { manager, store, ref, settle } = await harness()
    const host = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        cancelTask: (id, reason, options) => manager.cancelTask(id, reason, options),
        sendToTask: async (input) => {
          const outcome = await sendOutcome({ taskId: input.idOrName })
          interleave({ store, taskId: input.idOrName, epoch: moveTo })
          return outcome
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })
    return { host, manager, store, ref, settle }
  }

  test.each([
    { branch: "revived", outcome: (taskId: string): SendOutcome => ({ kind: "revived", task_id: taskId, run_epoch: 1 }), moveTo: 2 },
    { branch: "steered", outcome: (taskId: string): SendOutcome => ({ kind: "steered", task_id: taskId, status: "running", delivered: "steer" }), moveTo: 1 },
    { branch: "queued", outcome: (taskId: string): SendOutcome => ({ kind: "queued", task_id: taskId, queue_position: 1 }), moveTo: 1 },
  ])("a $branch send whose follow-up run started before the re-read returns that run's ref and says it continued", async ({ outcome, moveTo }) => {
    const { host, ref } = await racingHost(async ({ taskId }) => outcome(taskId), moveTo)

    const reply = await host.send(ref, "next", OWNER)

    expect(reply.ref.run_epoch).toBe(moveTo)
    expect(reply.phase).toBe("pending")
    expect(reply.host_status).toBe(`continued as epoch ${moveTo}`)
    expect((await host.watch([reply.ref], OWNER)).initial.map((s) => s.ref.run_epoch)).toEqual([moveTo])
  })

  test("a revive whose run is rolled back before the re-read is refused, not reported as a newer or older run", async () => {
    const rollBack: Interleave = ({ store, taskId }) => {
      store.mutate(taskId, (record) => ({ ...record, status: "completed", run_start_epoch: 0, notification: { ...record.notification, run_epoch: 0 } }))
    }
    const { host, ref } = await racingHost(async ({ taskId }) => ({ kind: "revived", task_id: taskId, run_epoch: 1 }), 0, rollBack)

    await expect(host.send(ref, "next", OWNER)).rejects.toMatchObject({ code: "eval_handle_send_refused" })
  })

  test.each([
    { outcome: "cancelled" as const, expect: { cancelled: true, phase: "cancelled" } },
    { outcome: "noop" as const, expect: "eval_handle_stale" },
  // No cancel_pending row: a pending cancel blocks revive and steer, so a newer run cannot start under one.
  ])("a cancel the engine answers $outcome, with a newer run started before the re-read, never reports that run", async (row) => {
    const { manager, store, ref } = await harness()
    const host = createEvalHandleHost({
      tasks: {
        get: (id) => manager.get(id),
        waitFor: (id, options) => manager.waitFor(id, options),
        sendToTask: (input) => manager.sendToTask(input),
        cancelTask: async (id) => {
          startFollowUpRun({ store, taskId: id, epoch: 1 })
          const status = store.load(id)?.status ?? "running"
          if (row.outcome === "cancelled") return { kind: "cancelled", task_id: id, previous_status: "running" }
          return { kind: "noop", task_id: id, status, reason: "already ended" }
        },
      },
      workpools: NO_POOLS,
      poolCaller: (sessionId) => ({ sessionId, rootSessionId: sessionId, depth: 0, cwd: "/" }),
      stateDir: store.stateDir,
    })

    if (typeof row.expect === "string") await expect(host.cancel(ref, OWNER)).rejects.toMatchObject({ code: row.expect })
    else expect(await host.cancel(ref, OWNER)).toEqual({ ref, ...row.expect })
  })
})
