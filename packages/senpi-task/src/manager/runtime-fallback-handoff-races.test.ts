import { afterEach, describe, expect, test } from "bun:test"

import { createManagerResidencyRegistry } from "../../../omo-senpi/src/components/task/residency-registry"
import { createTaskLifecycle } from "../lifecycle/create"
import type { ResolvedModelRecord, TaskRecord } from "../state"
import { createTaskRecordStore, type TaskRecordStore } from "../store"
import type { ManagedChildHandle } from "./child-handle"
import { TaskConcurrency } from "./concurrency"
import { baseSpec, cleanupProjects, FakeRunner, settings, tempProject } from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ManagedStartSpec } from "./types"
import { NO_HOST_ENDPOINT } from "../lifecycle/host-session"

// The runtime-fallback handoff is committed before the failed rung's session finishes closing. Every
// way that window can end - another owner winning the handoff, an interrupt, a cancel - must leave
// no lease and no handle behind, or a lane at concurrency one never admits another task.

afterEach(cleanupProjects)

const FIRST = "test/first"
const NEXT = "test/next"
const OWNER_PID = 11_001

function rung(id: string): ResolvedModelRecord {
  return { source: "category", provider: "test", model_id: id, display: `test/${id}` }
}

class SlowCloseRunner extends FakeRunner {
  constructor(readonly kind: "host-session" | "in-process") {
    super()
  }

  readonly closing = Promise.withResolvers<void>()
  readonly finishClose = Promise.withResolvers<void>()
  closeFailure: Error | undefined
  nextStart: (() => Promise<void>) | undefined

  override async start(spec: ManagedStartSpec): Promise<ManagedChildHandle> {
    const handle = await super.start(spec)
    if (spec.model === NEXT && this.nextStart !== undefined) await this.nextStart()
    const hostSession = { socket: "/tmp/dh-fake/rpc.sock", routingId: `routing-${spec.model}`, sessionPath: `/tmp/dh-fake/${spec.taskId}.jsonl`, instanceId: "fake" }
    return Object.assign(handle, {
      kind: this.kind,
      ...(this.kind === "host-session" ? { hostSession } : {}),
      dispose: async () => {
        if (spec.model !== FIRST) return
        this.closing.resolve()
        await this.finishClose.promise
        if (this.closeFailure !== undefined) throw this.closeFailure
      },
    })
  }
}

type MutateHook = (taskId: string, change: (record: TaskRecord) => TaskRecord, mutate: TaskRecordStore["mutate"]) => TaskRecord | null

// Every store call goes to the real store; `mutate` can be intercepted to interleave another owner.
function interceptableStore(base: TaskRecordStore, hook: { current?: MutateHook }): TaskRecordStore {
  return new Proxy(base, {
    get(target, property) {
      if (property === "mutate") {
        return (taskId: string, change: (record: TaskRecord) => TaskRecord) =>
          hook.current === undefined ? target.mutate(taskId, change) : hook.current(taskId, change, target.mutate)
      }
      const value: unknown = Reflect.get(target, property, target)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

function lane(kind: "host-session" | "in-process" = "host-session") {
  const runner = new SlowCloseRunner(kind)
  const mutateHook: { current?: MutateHook } = {}
  const store = interceptableStore(createTaskRecordStore({ project_dir: tempProject() }), mutateHook)
  const config = settings({ default_execution_mode: "process", default_concurrency: 1, global_concurrency: 1 })
  const concurrency = new TaskConcurrency(config)
  const manager = createTaskManager({
    store,
    config,
    concurrency,
    cwd: "/tmp",
    hostPid: OWNER_PID,
    runners: { process: runner, "in-process": runner },
    planner: (spec) => ({
      kind: "resolved",
      plan: spec.name === "fallback"
        ? { model: FIRST, requested_model: rung("first"), resolved_model: rung("first"), fallback_models: [rung("next")] }
        : { model: FIRST },
    }),
    destruction: { destroyResidentTask: (taskId, cause) => lifecycle.destroyResidentTask(taskId, cause) },
  })
  const lifecycle = createTaskLifecycle({ hostEndpoint: NO_HOST_ENDPOINT, store, config, hostPid: OWNER_PID, registry: createManagerResidencyRegistry(() => manager) })
  const dispose = (): void => {
    runner.finishClose.resolve()
    lifecycle.dispose?.()
    manager.workpools.dispose()
    for (const taskId of manager.residentTaskIds()) manager.forget(taskId, { path: "end" })
  }
  return { runner, store, mutateHook, concurrency, manager, dispose }
}

describe("runtime fallback handoff races", () => {
  test("#given another owner takes the task at its epoch #when the handoff loses the fence #then this process lets go of its run and its lease", async () => {
    // given
    const f = lane()
    const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
    if (task.kind !== "started") throw new Error("expected the task to start")
    const displaced = Promise.withResolvers<void>()
    f.mutateHook.current = (taskId, change, mutate) => {
      if (taskId !== task.task_id) return mutate(taskId, change)
      f.mutateHook.current = undefined
      mutate(taskId, (record) => ({ ...record, host_pid: OWNER_PID + 1, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
      const result = mutate(taskId, change)
      displaced.resolve()
      return result
    }

    try {
      // when
      f.runner.handles.get(task.task_id)?.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      await displaced.promise
      const following = await f.manager.start(baseSpec({ name: "following", execution_mode: "process" }))

      // then
      expect(f.store.load(task.task_id)?.host_pid).toBe(OWNER_PID + 1)
      expect(f.concurrency.leaseState(task.task_id, 0)).toBeUndefined()
      expect(f.manager.getResidentHandle(task.task_id)).toBeUndefined()
      expect(following.kind === "started" ? f.store.load(following.task_id)?.status : following.kind).toBe("running")
      expect(f.runner.startedSpecs.filter((spec) => spec.model === NEXT)).toEqual([])
    } finally {
      f.dispose()
    }
  })

  for (const ending of ["interrupt", "cancel"] as const) {
    test(`#given the failed rung is still closing #when the task is ${ending === "interrupt" ? "interrupted" : "cancelled"} #then no lease is stranded and no next rung launches`, async () => {
      // given
      const f = lane()
      const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
      if (task.kind !== "started") throw new Error("expected the task to start")
      const first = f.runner.handles.get(task.task_id)
      if (first === undefined) throw new Error("expected the first rung's handle")
      const unsubscribed = first.waitForUnsubscription()

      try {
        // when
        first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
        await f.runner.closing.promise
        const ended = ending === "interrupt" ? f.manager.interruptTask(task.task_id) : f.manager.cancelTask(task.task_id)
        f.runner.finishClose.resolve()
        expect((await ended).kind).toBe(ending === "interrupt" ? "interrupted" : "cancelled")
        await unsubscribed
        const following = await f.manager.start(baseSpec({ name: "following", execution_mode: "process" }))

        // then
        expect(f.concurrency.leaseState(task.task_id, 0)).toBeUndefined()
        expect(f.concurrency.leaseState(task.task_id, 1)).toBeUndefined()
        expect(f.runner.startedSpecs.filter((spec) => spec.model === NEXT)).toEqual([])
        expect(following.kind === "started" ? f.store.load(following.task_id)?.status : following.kind).toBe("running")
      } finally {
        f.dispose()
      }
    })
  }

  for (const close of ["resolves", "rejects"] as const) {
    test(`#given an interrupt while the failed rung is closing #when the task is continued before the close ${close} #then the closing rung is not revived and nothing is stranded`, async () => {
      // given
      const f = lane()
      const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
      if (task.kind !== "started") throw new Error("expected the task to start")
      const first = f.runner.handles.get(task.task_id)
      if (first === undefined) throw new Error("expected the first rung's handle")
      const unsubscribed = first.waitForUnsubscription()
      if (close === "rejects") f.runner.closeFailure = new Error("controlled close failure")

      try {
        // when
        first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
        await f.runner.closing.promise
        expect((await f.manager.interruptTask(task.task_id)).kind).toBe("interrupted")
        const continued = await f.manager.continueTask(task.task_id, "continue now")
        f.runner.finishClose.resolve()
        await unsubscribed
        const following = await f.manager.start(baseSpec({ name: "following", execution_mode: "process" }))

        // then
        expect(continued.kind).not.toBe("continued")
        expect(first.followUpCalls).toEqual([])
        expect(f.store.load(task.task_id)?.status).toBe("interrupted")
        expect(f.concurrency.leaseState(task.task_id, 0)).toBeUndefined()
        expect(f.concurrency.leaseState(task.task_id, 1)).toBeUndefined()
        expect(f.concurrency.leaseState(task.task_id, 2)).toBeUndefined()
        expect(following.kind === "started" ? f.store.load(following.task_id)?.status : following.kind).toBe("running")
      } finally {
        f.dispose()
      }
    })
  }

  test("#given another owner takes the handoff while the failed rung is closing #when the close finishes #then the obsolete next rung is never started", async () => {
    // given
    const f = lane()
    const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
    if (task.kind !== "started") throw new Error("expected the task to start")
    const first = f.runner.handles.get(task.task_id)
    if (first === undefined) throw new Error("expected the first rung's handle")
    const unsubscribed = first.waitForUnsubscription()

    try {
      // when
      first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      await f.runner.closing.promise
      f.store.mutate(task.task_id, (record) => ({ ...record, host_pid: OWNER_PID + 1, notification: { ...record.notification, run_epoch: 2 } }))
      f.runner.finishClose.resolve()
      await unsubscribed
      const following = await f.manager.start(baseSpec({ name: "following", execution_mode: "process" }))

      // then
      expect(f.runner.startedSpecs.filter((spec) => spec.model === NEXT)).toEqual([])
      expect(f.store.load(task.task_id)).toMatchObject({ status: "running", host_pid: OWNER_PID + 1, notification: { run_epoch: 2 } })
      expect(f.concurrency.leaseState(task.task_id, 1)).toBeUndefined()
      expect(following.kind === "started" ? f.store.load(following.task_id)?.status : following.kind).toBe("running")
    } finally {
      f.dispose()
    }
  })

  test("#given another owner takes the task while the next rung starts #when that start rejects #then the newer owner's run is not failed", async () => {
    // given
    const f = lane()
    const entered = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    f.runner.nextStart = async () => {
      entered.resolve()
      await release.promise
      throw new Error("transport start rejected")
    }
    const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
    if (task.kind !== "started") throw new Error("expected the task to start")
    const first = f.runner.handles.get(task.task_id)
    if (first === undefined) throw new Error("expected the first rung's handle")
    const nextRungSettled = Promise.withResolvers<void>()
    const releaseLease = f.concurrency.releaseLease.bind(f.concurrency)
    f.concurrency.releaseLease = (taskId: string, runEpoch: number) => {
      releaseLease(taskId, runEpoch)
      if (taskId === task.task_id && runEpoch === 1) nextRungSettled.resolve()
    }

    try {
      // when
      first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
      f.runner.finishClose.resolve()
      await entered.promise
      f.store.mutate(task.task_id, (record) => ({ ...record, host_pid: OWNER_PID + 1, notification: { ...record.notification, run_epoch: record.notification.run_epoch + 1 } }))
      release.resolve()
      await nextRungSettled.promise

      // then
      expect(f.store.load(task.task_id)).toMatchObject({ status: "running", host_pid: OWNER_PID + 1 })
    } finally {
      f.dispose()
    }
  })

  for (const [ending, kind] of [["interrupt", "host-session"], ["cancel", "host-session"], ["interrupt", "in-process"], ["cancel", "in-process"]] as const) {
    test(`#given a ${kind} rung whose close rejects #when the task was ${ending === "interrupt" ? "interrupted" : "cancelled"} during it #then the unclosed child keeps a cleanup owner and no lease is stranded`, async () => {
      // given
      const f = lane(kind)
      f.runner.closeFailure = new Error("controlled close failure")
      const task = await f.manager.start(baseSpec({ name: "fallback", execution_mode: "process" }))
      if (task.kind !== "started") throw new Error("expected the task to start")
      const first = f.runner.handles.get(task.task_id)
      if (first === undefined) throw new Error("expected the first rung's handle")
      const unsubscribed = first.waitForUnsubscription()

      try {
        // when
        first.settle({ status: "error", failure: { kind: "child-turn-failed", message: "500: upstream overloaded" } })
        await f.runner.closing.promise
        const ended = ending === "interrupt" ? f.manager.interruptTask(task.task_id) : f.manager.cancelTask(task.task_id)
        f.runner.finishClose.resolve()
        await ended.catch(() => undefined)
        await unsubscribed
        const following = await f.manager.start(baseSpec({ name: "following", execution_mode: "process" }))

        // then: a daemon session goes back on the record for the orphan path; an in-process child,
        // which nothing outside this process can reach, stays resident as its own cleanup owner
        if (kind === "host-session") expect(f.store.load(task.task_id)?.host_session?.session_path).toBe(`/tmp/dh-fake/${task.task_id}.jsonl`)
        else expect(f.manager.getResidentHandle(task.task_id)).toBeDefined()
        expect(f.concurrency.leaseState(task.task_id, 0)).toBeUndefined()
        expect(f.runner.startedSpecs.filter((spec) => spec.model === NEXT)).toEqual([])
        expect(following.kind === "started" ? f.store.load(following.task_id)?.status : following.kind).toBe("running")
      } finally {
        f.dispose()
      }
    })
  }
})
