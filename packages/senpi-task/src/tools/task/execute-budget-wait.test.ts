import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"
import { resolvePromptCacheSafeWaitSeconds, type ScheduleDeadline } from "./foreground-wait"
import type { TaskToolContext } from "./types"

const TASK_ID = "st_00000270"
const BATCH_IDS = ["st_batch_budget_1", "st_batch_budget_2", "st_batch_budget_3"] as const

type Deferred<T> = {
  readonly promise: Promise<T>
  readonly resolve: (value: T) => void
  readonly reject: (reason: unknown) => void
}

type ScheduledDeadline = {
  readonly delayMs: number
  cancelled: boolean
  fire(): void
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => {}
  let reject: (reason: unknown) => void = () => {}
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function deadlineHarness(): { readonly scheduleDeadline: ScheduleDeadline; readonly deadlines: ScheduledDeadline[] } {
  const deadlines: ScheduledDeadline[] = []
  return {
    deadlines,
    scheduleDeadline: (callback, delayMs) => {
      const deadline: ScheduledDeadline = {
        delayMs,
        cancelled: false,
        fire: () => {
          if (!deadline.cancelled) callback()
        },
      }
      deadlines.push(deadline)
      return () => {
        deadline.cancelled = true
      }
    },
  }
}

function started(taskId = TASK_ID, name = "budgeted-task"): Promise<StartResult> {
  return Promise.resolve({ kind: "started", task_id: taskId, status: "running", name })
}

function textOf(result: Awaited<ReturnType<ReturnType<typeof buildTaskExecute>>>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

function contextWithBudget(getBudget: () => number | undefined): TaskToolContext {
  return { ...CTX, getPromptCacheSafeWaitSeconds: getBudget }
}

describe("prompt-cache-safe foreground wait budget", () => {
  test("#given a context getter and env bridge #when resolving the budget #then the feature-detected getter wins", () => {
    // given
    const ctx = contextWithBudget(() => 270)

    // when
    const fromGetter = resolvePromptCacheSafeWaitSeconds(ctx, { PI_PROMPT_CACHE_SAFE_WAIT_SECONDS: "12" })
    const fromEnv = resolvePromptCacheSafeWaitSeconds(CTX, { PI_PROMPT_CACHE_SAFE_WAIT_SECONDS: "45" })
    const absent = resolvePromptCacheSafeWaitSeconds(CTX, {})

    // then
    expect(fromGetter).toBe(270)
    expect(fromEnv).toBe(45)
    expect(absent).toBeUndefined()
  })

  test("#given a running foreground child #when its prompt-cache-safe budget expires #then it is promoted without cancellation and returns background guidance", async () => {
    // given
    const wait = deferred<TaskRecord>()
    const waitStarted = deferred<void>()
    const background = new Set<string>()
    const timer = deadlineHarness()
    let cancelCalls = 0
    const manager = createFakeManager({
      start: () => started(),
      waitFor: () => {
        waitStarted.resolve()
        return wait.promise
      },
      promoteToBackground: (taskId) => {
        const promoted = !background.has(taskId)
        background.add(taskId)
        return promoted
      },
      wasBackground: (taskId) => background.has(taskId),
      cancelTask: async (taskId) => {
        cancelCalls += 1
        return { kind: "cancelled", task_id: taskId, previous_status: "running" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager), { env: {}, scheduleDeadline: timer.scheduleDeadline })
    const execution = execute(
      "budget-conversion",
      { prompt: "keep working", category: "quick" },
      undefined,
      undefined,
      contextWithBudget(() => 270),
    )
    await waitStarted.promise

    // when
    expect(timer.deadlines.map((deadline) => deadline.delayMs)).toEqual([270_000])
    timer.deadlines[0]?.fire()
    const output = await execution

    // then
    expect(manager.wasBackground(TASK_ID)).toBe(true)
    expect(cancelCalls).toBe(0)
    expect(output.details).toMatchObject({ task_id: TASK_ID, status: "running", run_in_background: true })
    expect(textOf(output)).toContain(`prompt-cache-safe budget (270s)`)
    expect(textOf(output)).toContain(TASK_ID)
    expect(textOf(output)).toContain("Completion will arrive as a notification")
    expect(textOf(output)).toContain("task_send")
    expect(textOf(output)).toContain("task_output")

    wait.resolve(makeRecord({ task_id: TASK_ID, status: "completed", final_response: "done later" }))
    await Promise.resolve()
  })

  test("#given no getter and no env budget #when a foreground child waits #then no deadline is scheduled and waitFor remains unbounded", async () => {
    // given
    const wait = deferred<TaskRecord>()
    const waitStarted = deferred<void>()
    const timer = deadlineHarness()
    const manager = createFakeManager({
      start: () => started(),
      waitFor: () => {
        waitStarted.resolve()
        return wait.promise
      },
    })
    const execute = buildTaskExecute(makeDeps(manager), { env: {}, scheduleDeadline: timer.scheduleDeadline })
    const execution = execute("unbounded", { prompt: "finish", category: "quick" }, undefined, undefined, CTX)
    await waitStarted.promise

    // when
    expect(timer.deadlines).toHaveLength(0)
    wait.resolve(makeRecord({ task_id: TASK_ID, status: "completed", final_response: "finished" }))
    const output = await execution

    // then
    expect(output.details.status).toBe("completed")
    expect(textOf(output)).toContain("finished")
  })

  test("#given a budgeted foreground child #when the parent aborts before the deadline #then existing cancellation semantics win and the deadline is cleared", async () => {
    // given
    const controller = new AbortController()
    const waitStarted = deferred<void>()
    const timer = deadlineHarness()
    const cancelled: string[] = []
    const manager = createFakeManager({
      start: () => started(),
      waitFor: (_taskId, options) => {
        waitStarted.resolve()
        return new Promise<TaskRecord>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) throw new Error("expected abort signal")
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
      cancelTask: async (taskId) => {
        cancelled.push(taskId)
        return { kind: "cancelled", task_id: taskId, previous_status: "running" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager), { env: {}, scheduleDeadline: timer.scheduleDeadline })
    const execution = execute(
      "abort-before-budget",
      { prompt: "work", category: "quick" },
      controller.signal,
      undefined,
      contextWithBudget(() => 270),
    )
    await waitStarted.promise

    // when
    controller.abort(new Error("parent stopped"))
    const output = await execution

    // then
    expect(cancelled).toEqual([TASK_ID])
    expect(output.details.status).toBe("cancelled")
    expect(timer.deadlines).toHaveLength(1)
    expect(timer.deadlines[0]?.cancelled).toBe(true)
    expect(manager.wasBackground(TASK_ID)).toBe(false)
  })

  test("#given a foreground batch with changing budgets #when waits start per item #then settled items stay inline and each remaining item converts on its own deadline", async () => {
    // given
    const waits = BATCH_IDS.map(() => deferred<TaskRecord>())
    const allWaitsStarted = deferred<void>()
    const timer = deadlineHarness()
    const background = new Set<string>()
    const budgets = [1, 2, 3]
    let budgetReads = 0
    let startIndex = 0
    let waitCalls = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = BATCH_IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return { kind: "started", task_id: taskId, status: "running", name: `item-${startIndex}` }
      },
      waitFor: (taskId) => {
        const index = BATCH_IDS.indexOf(taskId as typeof BATCH_IDS[number])
        const wait = waits[index]
        if (wait === undefined) throw new Error(`unexpected task id ${taskId}`)
        waitCalls += 1
        if (waitCalls === BATCH_IDS.length) allWaitsStarted.resolve()
        return wait.promise
      },
      promoteToBackground: (taskId) => {
        const promoted = !background.has(taskId)
        background.add(taskId)
        return promoted
      },
      wasBackground: (taskId) => background.has(taskId),
    })
    const ctx = contextWithBudget(() => {
      const budget = budgets[budgetReads]
      budgetReads += 1
      return budget
    })
    const execute = buildTaskExecute(makeDeps(manager), { env: {}, scheduleDeadline: timer.scheduleDeadline })
    const execution = execute(
      "batch-budget",
      { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      ctx,
    )
    await allWaitsStarted.promise

    // when
    expect(budgetReads).toBe(3)
    expect(timer.deadlines.map((deadline) => deadline.delayMs)).toEqual([1_000, 2_000, 3_000])
    waits[0]?.resolve(makeRecord({ task_id: BATCH_IDS[0], name: "item-1", status: "completed", final_response: "first done" }))
    await Promise.resolve()
    timer.deadlines[1]?.fire()
    timer.deadlines[2]?.fire()
    const output = await execution

    // then
    expect(background).toEqual(new Set([BATCH_IDS[1], BATCH_IDS[2]]))
    expect(output.details.status).toBe("running")
    expect(output.details.run_in_background).toBe(true)
    expect(output.details.items).toMatchObject([
      { task_id: BATCH_IDS[0], status: "completed" },
      { task_id: BATCH_IDS[1], status: "running", run_in_background: true },
      { task_id: BATCH_IDS[2], status: "running", run_in_background: true },
    ])
    expect(textOf(output)).toContain("first done")
    expect(textOf(output)).toContain(`prompt-cache-safe budget (2s)`)
    expect(textOf(output)).toContain(`prompt-cache-safe budget (3s)`)
    expect(textOf(output)).toContain(BATCH_IDS[1])
    expect(textOf(output)).toContain(BATCH_IDS[2])

    waits[1]?.resolve(makeRecord({ task_id: BATCH_IDS[1], status: "completed" }))
    waits[2]?.resolve(makeRecord({ task_id: BATCH_IDS[2], status: "completed" }))
    await Promise.resolve()
  })
})
