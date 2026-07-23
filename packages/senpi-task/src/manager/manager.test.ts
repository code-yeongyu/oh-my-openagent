import { readFileSync } from "node:fs"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import type { Theme, ThemeColor } from "@code-yeongyu/senpi"

import { createTaskLifecycle } from "../lifecycle"
import type { ResidentHandle, ResidencyRegistry } from "../lifecycle"
import type { ResolvedModelRecord } from "../state"
import { createTaskRecordStore } from "../store"
import { CTX, makeDeps } from "../tools/task/__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "../tools/task/execute"
import { renderTaskResultLines } from "../tools/task/renderers"
import type { ManagedChildHandle } from "./child-handle"
import {
  FakeRunner,
  baseSpec,
  cleanupProjects,
  categoryPlanner,
  flush,
  makeHandle,
  makeManager,
  settings,
  tempProject,
} from "./__fixtures__/manager-fakes"
import { createTaskManager } from "./manager"
import type { ChildPlanner, ManagedRunner, SpawnAdmission, TaskManager } from "./types"

const RENDERER_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  italic: (text: string) => `<i>${text}</i>`,
} satisfies Pick<Theme, "fg" | "italic">

afterEach(cleanupProjects)

function toResidentHandle(handle: ManagedChildHandle | undefined): ResidentHandle | undefined {
  if (handle === undefined) return undefined
  const kind = handle.pid === undefined ? "in-process" : "rpc"
  return {
    task_id: handle.task_id,
    kind,
    pid: handle.pid,
    abort: () => handle.abort(),
    dispose: () => handle.dispose(),
    terminate: () => (kind === "rpc" ? handle.abort() : Promise.resolve()),
  }
}

function makeLifecycleManager(runner: ManagedRunner, config = settings({ default_concurrency: 1, max_depth: 1 })) {
  const project = tempProject()
  const store = createTaskRecordStore({ project_dir: project })
  let managerRef: TaskManager | undefined
  const getManager = (): TaskManager => {
    if (managerRef === undefined) throw new Error("manager accessed before test composition finished")
    return managerRef
  }
  const registry: ResidencyRegistry = {
    get: (taskId) => toResidentHandle(getManager().getResidentHandle(taskId)),
    entries: () =>
      getManager()
        .residentTaskIds()
        .map((taskId) => toResidentHandle(getManager().getResidentHandle(taskId)))
        .filter((handle): handle is ResidentHandle => handle !== undefined),
    forget: (taskId) => getManager().forget(taskId),
    hasPendingSends: () => false,
  }
  const lifecycle = createTaskLifecycle({ store, registry, config })
  const manager = createTaskManager({
    store,
    runners: { "in-process": runner, process: runner },
    planner: categoryPlanner(),
    config,
    cwd: project,
    destruction: { destroyResidentTask: (taskId) => lifecycle.destroyResidentTask(taskId, "cancel") },
    admit: async (parentSessionId): Promise<SpawnAdmission> => {
      const admission = await lifecycle.admitResident(parentSessionId)
      switch (admission.kind) {
        case "admitted":
          return { kind: "admitted" }
        case "evicted":
          return { kind: "evicted", evicted_task_id: admission.evicted_task_id }
        case "rejected":
          return { kind: "rejected", message: admission.error.message }
      }
    },
  })
  managerRef = manager
  return { manager, store }
}

describe("TaskManager.start", () => {
  test("#given a valid spec #when started #then it returns a st_ id and running status with a persisted record", async () => {
    // given
    const { manager, store } = makeManager({})

    // when
    const result = await manager.start(baseSpec())

    // then
    expect(result.kind).toBe("started")
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.task_id).toMatch(/^st_[0-9a-f]{8}$/)
    expect(result.status).toBe("running")
    expect(store.load(result.task_id)?.status).toBe("running")
  })

  test("#given a child beyond max depth without allowance #when started #then DepthDenied is returned and zero records exist", async () => {
    // given
    const { manager, store } = makeManager({ config: settings({ max_depth: 1 }) })

    // when
    const result = await manager.start(baseSpec({ depth: 2 }))

    // then
    expect(result.kind).toBe("depth_denied")
    expect(store.list().records).toHaveLength(0)
  })

  test("#given a full model slot #when a further same-model task starts #then it queues FIFO and starts when a slot frees", async () => {
    // given
    const { manager, store, inProcess } = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })
    const first = await manager.start(baseSpec({ name: "a" }))
    if (first.kind !== "started") throw new Error("expected started")

    // when
    const second = await manager.start(baseSpec({ name: "b" }))
    if (second.kind !== "started") throw new Error("expected started")

    // then
    expect(second.status).toBe("pending")
    expect(second.queue_position).toBe(1)

    // when the first frees its slot
    inProcess.handles.get(first.task_id)?.settle({ status: "completed", finalResponse: "ok" })
    await flush()

    // then the queued task is now running
    expect(store.load(second.task_id)?.status).toBe("running")
    expect(store.load(first.task_id)?.status).toBe("completed")
  })

  test("#given two categories that resolve to different models #when both start under a shared limit of 1 #then both run", async () => {
    // given
    const planner = categoryPlanner({ quick: "anthropic/claude", deep: "openai/gpt" })
    const { manager, store } = makeManager({ planner, config: settings({ default_concurrency: 1, max_depth: 1 }) })

    // when
    const a = await manager.start(baseSpec({ category: "quick", name: "a" }))
    const b = await manager.start(baseSpec({ category: "deep", name: "b" }))

    // then
    if (a.kind !== "started" || b.kind !== "started") throw new Error("expected started")
    expect(a.status).toBe("running")
    expect(b.status).toBe("running")
    expect(store.load(a.task_id)?.status).toBe("running")
    expect(store.load(b.task_id)?.status).toBe("running")
  })

  test("#given a runner whose start throws #when a task starts #then the slot is released, the record is error, and a failure event is logged", async () => {
    // given
    const throwingRunner = new FakeRunner()
    throwingRunner.throwOnStart = true
    const { manager, store, project } = makeManager({
      inProcess: throwingRunner,
      config: settings({ default_concurrency: 1, max_depth: 1 }),
    })

    // when
    const result = await manager.start(baseSpec())

    // then
    expect(result.kind).toBe("start_failed")
    if (result.kind !== "start_failed") throw new Error("expected start_failed")
    expect(store.load(result.task_id)?.status).toBe("error")
    const jsonl = readFileSync(join(project, ".omo", "senpi-task", "logs", `${result.task_id}.jsonl`), "utf8")
    expect(jsonl).toContain("error")

    // and the slot drained: a healthy runner can now start
    throwingRunner.throwOnStart = false
    const next = await manager.start(baseSpec())
    expect(next.kind).toBe("started")
    if (next.kind !== "started") throw new Error("expected started")
    expect(next.status).toBe("running")
  })

  test("#given a requested name that collides in the same parent #when started #then a -2 suffix and a warning are returned", async () => {
    // given
    const { manager } = makeManager({})
    await manager.start(baseSpec({ name: "reviewer" }))

    // when
    const second = await manager.start(baseSpec({ name: "reviewer" }))

    // then
    if (second.kind !== "started") throw new Error("expected started")
    expect(second.name).toBe("reviewer-2")
    expect(second.name_warning).toBeDefined()
  })

  test("#given execution_mode process on the spec #when started #then the process runner is used", async () => {
    // given
    const inProcess = new FakeRunner()
    const processRunner = new FakeRunner()
    const { manager } = makeManager({ inProcess, process: processRunner })

    // when
    await manager.start(baseSpec({ execution_mode: "process" }))

    // then
    expect(processRunner.startedSpecs).toHaveLength(1)
    expect(inProcess.startedSpecs).toHaveLength(0)
  })

  test("#given a resolved model plan #when started #then manager metadata surfaces persist resolved_model without prompt payloads", async () => {
    // given
    const resolvedModel: ResolvedModelRecord = {
      provider: "anthropic",
      model_id: "claude-sonnet-4-20250514",
      display: "Claude Sonnet 4",
      variant: "sonnet",
      reasoning_effort: "medium",
      source: "category",
    }
    const planner: ChildPlanner = (spec) => ({
      kind: "resolved",
      plan: {
        model: spec.model ?? "anthropic/claude",
        resolved_model: resolvedModel,
        ...(spec.category !== undefined ? { category: spec.category } : {}),
      },
    })
    const { manager, store } = makeManager({ planner })

    // when
    const result = await manager.start(baseSpec({ prompt: "private prompt payload" }))

    // then
    expect(result.kind).toBe("started")
    if (result.kind !== "started") throw new Error("expected started")
    expect(result.resolved_model).toEqual(resolvedModel)

    const persisted = store.load(result.task_id)
    expect(persisted?.resolved_model).toEqual(resolvedModel)
    expect(manager.get(result.task_id)?.resolved_model).toEqual(resolvedModel)
    expect(manager.list({ scope: "all" })[0]?.record.resolved_model).toEqual(resolvedModel)

    const rawRecord = readFileSync(join(store.stateDir, "tasks", `${result.task_id}.json`), "utf8")
    expect(rawRecord).toContain('"resolved_model"')
    expect(rawRecord).not.toContain("private prompt payload")
    expect(rawRecord).not.toContain('"prompt"')
    expect(rawRecord).not.toContain('"messages"')
  })

  test("#given a resolved ultrabrain plan whose runner throws #when the real task mapping renders start_failed #then resolved context reaches the error row without the prompt", async () => {
    // given
    const resolvedModel: ResolvedModelRecord = {
      provider: "openai",
      model_id: "gpt-5.6-sol",
      display: "GPT-5.6 Sol",
      reasoning_effort: "xhigh",
      source: "category",
    }
    const planner: ChildPlanner = () => ({
      kind: "resolved",
      plan: { model: "openai/gpt-5.6-sol", resolved_model: resolvedModel, category: "ultrabrain" },
    })
    const runner = new FakeRunner()
    runner.throwOnStart = true
    const { manager } = makeManager({ planner, inProcess: runner })
    const privatePrompt = "private prompt payload"

    // when
    const result = await buildTaskExecute(makeDeps(manager))(
      "call-start-failed",
      { prompt: privatePrompt, category: "ultrabrain", run_in_background: true },
      undefined,
      undefined,
      CTX,
    )
    const [row] = renderTaskResultLines(result.details, RENDERER_THEME)

    // then
    expect(result.details).toEqual({
      task_id: result.details.task_id,
      status: "error",
      mode: "spawn",
      name: result.details.task_id,
      category: "ultrabrain",
      execution_mode: "in-process",
      model: "openai/gpt-5.6-sol",
      resolved_model: resolvedModel,
      run_in_background: true,
      reason: "Task runner failed to start.",
    })
    expect(row).toBe(
      `task category:ultrabrain (openai GPT-5.6 Sol reasoning:xhigh) <i>background</i> error id:${result.details.task_id} reason:Task runner failed to start.`,
    )
    expect(JSON.stringify({ result, row })).not.toContain(privatePrompt)
  })
})

describe("TaskManager.waitFor", () => {
  test("#given a running task with an abortable wait w2waitfor #when the signal aborts #then the wait rejects and its waiter key is removed", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const controller = new AbortController()
    const reason = new Error("parent aborted")
    const waiting = manager.waitFor(started.task_id, { signal: controller.signal })
    expect(manager.waiterKeyCount()).toBe(1)

    // when
    const observed = waiting.catch((error: unknown) => error)
    controller.abort(reason)

    // then
    expect(await observed).toBe(reason)
    expect(manager.waiterKeyCount()).toBe(0)
  })

  test("#given an abortable wait that resolves terminal w2waitfor #when the signal aborts afterwards #then abort is a no-op without an unhandled rejection", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected handle")
    const controller = new AbortController()
    const waiting = manager.waitFor(started.task_id, { signal: controller.signal })
    expect(manager.waiterKeyCount()).toBe(1)
    handle.settle({ status: "completed", finalResponse: "done" })
    const completed = await waiting

    // when
    controller.abort(new Error("late abort"))
    await flush()

    // then
    expect(completed.status).toBe("completed")
    expect(manager.waiterKeyCount()).toBe(0)
  })

  test("#given a pre-aborted signal w2waitfor #when waitFor is called #then it rejects immediately without registering a waiter", async () => {
    // given
    const { manager } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const controller = new AbortController()
    const reason = new Error("already aborted")
    controller.abort(reason)

    // when
    const waiting = manager.waitFor(started.task_id, { signal: controller.signal })

    // then
    expect(manager.waiterKeyCount()).toBe(0)
    expect(waiting).rejects.toBe(reason)
  })

  test("#given two concurrent waiters for one task w2waitfor #when one signal aborts #then the surviving waiter still resolves on settle", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected handle")
    const controller = new AbortController()
    const reason = new Error("first waiter aborted")
    const abandoned = manager.waitFor(started.task_id, { signal: controller.signal })
    const surviving = manager.waitFor(started.task_id)
    expect(manager.waiterKeyCount()).toBe(1)

    // when
    const observed = abandoned.catch((error: unknown) => error)
    controller.abort(reason)
    expect(await observed).toBe(reason)
    handle.settle({ status: "completed", finalResponse: "survived" })

    // then
    expect((await surviving).final_response).toBe("survived")
    expect(manager.waiterKeyCount()).toBe(0)
  })

  test("#given a running task and a signal-less wait w2waitfor #when the task settles #then waitFor resolves as before", async () => {
    // given
    const { manager, inProcess } = makeManager({})
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error("expected started")
    const handle = inProcess.handles.get(started.task_id)
    if (handle === undefined) throw new Error("expected handle")
    const waiting = manager.waitFor(started.task_id)
    expect(manager.waiterKeyCount()).toBe(1)

    // when
    handle.settle({ status: "completed", finalResponse: "done" })

    // then
    expect((await waiting).final_response).toBe("done")
    expect(manager.waiterKeyCount()).toBe(0)
  })
})

describe("TaskManager child subscriptions", () => {
  test("#given a pending task #when its concurrency slot is promoted #then the deferred child listener attaches to its managed handle", async () => {
    const runner = new FakeRunner()
    const { manager } = makeManager({ config: settings({ default_concurrency: 1 }), inProcess: runner, process: runner })
    const first = await manager.start(baseSpec({ name: "running" }))
    const queued = await manager.start(baseSpec({ name: "queued" }))
    if (first.kind !== "started" || queued.kind !== "started") throw new Error("expected starts")
    expect(queued.status).toBe("pending")

    const unsubscribe = manager.subscribeChild(queued.task_id, () => {})
    expect(runner.handles.get(queued.task_id)).toBeUndefined()

    runner.handles.get(first.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await flush()

    const promoted = runner.handles.get(queued.task_id)
    expect(promoted?.subscribeCount()).toBe(2)
    unsubscribe()
    expect(promoted?.unsubscribeCount()).toBe(1)
  })
})

describe("TaskManager pending cancellation", () => {
  test("#given a queued task at the residency cap w2pend #when cancelled #then its wait settles cancelled and a later spawn is admitted", async () => {
    // given
    const runner = new FakeRunner()
    const { manager, store } = makeLifecycleManager(
      runner,
      settings({ default_concurrency: 1, max_depth: 1, residency_max_children: 2 }),
    )
    const first = await manager.start(baseSpec({ name: "running" }))
    const queued = await manager.start(baseSpec({ name: "queued", run_in_background: true }))
    if (first.kind !== "started" || queued.kind !== "started") throw new Error("expected started")
    expect(queued.status).toBe("pending")
    const waiting = manager.waitFor(queued.task_id)

    // when
    const cancelled = await manager.cancelTask(queued.task_id, "queue no longer needed")

    // then
    if (cancelled.kind !== "cancelled") throw new Error("expected cancelled")
    expect(cancelled.previous_status).toBe("pending")
    expect((await waiting).status).toBe("cancelled")
    expect(store.load(queued.task_id)?.status).toBe("cancelled")
    expect(store.load(queued.task_id)?.residency_state).toBe("disposed")
    expect(manager.list({ scope: "all" }).find((entry) => entry.record.task_id === queued.task_id)?.queue_position).toBeUndefined()

    const later = await manager.start(baseSpec({ name: "later" }))
    expect(later.kind).toBe("started")
    if (later.kind !== "started") throw new Error("expected later spawn admitted")
    expect(later.status).toBe("pending")
    expect(runner.startedSpecs).toHaveLength(1)
  })

  test("#given a grant whose start transition loses to cancel w2pend #when the slot transfers #then the runner is skipped and the slot is released", async () => {
    // given
    const project = tempProject()
    const backing = createTaskRecordStore({ project_dir: project })
    let cancelBeforeStartTaskId: string | undefined
    const store = {
      ...backing,
      transition: (taskId: string, transition: Parameters<typeof backing.transition>[1]) => {
        if (transition.type === "start" && taskId === cancelBeforeStartTaskId) {
          cancelBeforeStartTaskId = undefined
          backing.transition(taskId, { type: "cancel", timestamp: new Date().toISOString() })
        }
        return backing.transition(taskId, transition)
      },
    }
    const runner = new FakeRunner()
    const config = settings({ default_concurrency: 1, max_depth: 1 })
    const manager = createTaskManager({
      store,
      runners: { "in-process": runner, process: runner },
      planner: categoryPlanner(),
      config,
      cwd: project,
    })
    const first = await manager.start(baseSpec({ name: "first" }))
    const queued = await manager.start(baseSpec({ name: "queued" }))
    if (first.kind !== "started" || queued.kind !== "started") throw new Error("expected started")
    cancelBeforeStartTaskId = queued.task_id

    // when
    runner.handles.get(first.task_id)?.settle({ status: "completed", finalResponse: "done" })
    await flush()

    // then
    expect(store.load(queued.task_id)?.status).toBe("cancelled")
    expect(runner.startedSpecs).toHaveLength(1)
    const later = await manager.start(baseSpec({ name: "later" }))
    if (later.kind !== "started") throw new Error("expected started")
    expect(later.status).toBe("running")
    expect(runner.startedSpecs).toHaveLength(2)
  })

  test("#given cancel lands while runner start awaits w2pend #when the handle arrives #then destruction tears it down, settles the wait, and releases the slot", async () => {
    // given
    let startCount = 0
    let firstHandle: ReturnType<typeof makeHandle> | undefined
    let delayedHandle: ManagedChildHandle | undefined
    let abortCalls = 0
    let disposeCalls = 0
    let markSecondStarted: () => void = () => {}
    const secondStarted = new Promise<void>((resolve) => {
      markSecondStarted = resolve
    })
    let resolveSecondStart: (handle: ManagedChildHandle) => void = () => {}
    const secondStart = new Promise<ManagedChildHandle>((resolve) => {
      resolveSecondStart = resolve
    })
    const runner: ManagedRunner = {
      start: (spec) => {
        startCount += 1
        if (startCount === 1) {
          firstHandle = makeHandle(spec.taskId)
          return Promise.resolve(firstHandle.handle)
        }
        if (startCount === 2) {
          const fake = makeHandle(spec.taskId)
          delayedHandle = {
            ...fake.handle,
            abort: async () => {
              abortCalls += 1
            },
            dispose: async () => {
              disposeCalls += 1
            },
          }
          markSecondStarted()
          return secondStart
        }
        return Promise.resolve(makeHandle(spec.taskId).handle)
      },
    }
    const { manager, store } = makeLifecycleManager(runner)
    const first = await manager.start(baseSpec({ name: "first" }))
    const queued = await manager.start(baseSpec({ name: "queued" }))
    if (first.kind !== "started" || queued.kind !== "started") throw new Error("expected started")
    const waiting = manager.waitFor(queued.task_id)
    if (firstHandle === undefined) throw new Error("expected first handle")
    firstHandle.settle({ status: "completed", finalResponse: "done" })
    await secondStarted

    // when
    const cancelled = await manager.cancelTask(queued.task_id, "cancel during start")
    if (delayedHandle === undefined) throw new Error("expected delayed handle")
    resolveSecondStart(delayedHandle)
    await flush()

    // then
    expect(cancelled.kind).toBe("cancelled")
    expect(abortCalls).toBe(1)
    expect(disposeCalls).toBe(1)
    expect(manager.residentTaskIds()).not.toContain(queued.task_id)
    expect((await waiting).status).toBe("cancelled")
    expect(store.load(queued.task_id)?.residency_state).toBe("disposed")
    const later = await manager.start(baseSpec({ name: "later" }))
    if (later.kind !== "started") throw new Error("expected started")
    expect(later.status).toBe("running")
  })

  test("#given a running task with one queued behind it w2pend #when the running task is cancelled #then the queued task receives the released slot", async () => {
    // given
    const { manager, store } = makeManager({ config: settings({ default_concurrency: 1, max_depth: 1 }) })
    const running = await manager.start(baseSpec({ name: "running" }))
    const queued = await manager.start(baseSpec({ name: "queued" }))
    if (running.kind !== "started" || queued.kind !== "started") throw new Error("expected started")

    // when
    const cancelled = await manager.cancelTask(running.task_id, "stop")
    await flush()

    // then
    expect(cancelled.kind).toBe("cancelled")
    expect(store.load(running.task_id)?.status).toBe("cancelled")
    expect(store.load(queued.task_id)?.status).toBe("running")
  })
})
