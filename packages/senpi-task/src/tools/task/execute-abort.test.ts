import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

const TASK_ID = "st_00000015"

function started(): Promise<StartResult> {
  return Promise.resolve({ kind: "started", task_id: TASK_ID, status: "running", name: "abortable-task" })
}

describe("buildTaskExecute abort handling", () => {
  test(" w2sig #given a pre-aborted signal #when spawn executes #then it returns cancelled without starting a child", async () => {
    // given
    let startCalls = 0
    const manager = createFakeManager({
      start: () => {
        startCalls += 1
        return started()
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    const controller = new AbortController()
    controller.abort(new Error("parent already aborted"))

    // when
    const result = await execute(
      "call-pre-abort",
      { prompt: "work", category: "quick", run_in_background: true },
      controller.signal,
      undefined,
      CTX,
    )

    // then
    expect(startCalls).toBe(0)
    expect(result.details).toMatchObject({
      task_id: "",
      status: "cancelled",
      mode: "spawn",
      reason: "Parent aborted before spawn",
    })
  })

  test(" w2sig #given a sync child waiting #when the parent aborts #then it cancels once and reports the task id", async () => {
    // given
    const controller = new AbortController()
    let observedSignal: AbortSignal | undefined
    let markWaiting: (() => void) | undefined
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve
    })
    const cancelCalls: Array<readonly [string, string | undefined]> = []
    const manager = createFakeManager({
      start: started,
      waitFor: (_taskId, options) => {
        observedSignal = options?.signal
        markWaiting?.()
        return new Promise<TaskRecord>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
        })
      },
      cancelTask: (taskId, reason) => {
        cancelCalls.push([taskId, reason])
        return Promise.resolve({ kind: "cancelled", task_id: taskId, previous_status: "running" })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    const execution = execute("call-mid-abort", { prompt: "work", category: "quick" }, controller.signal, undefined, CTX)
    await waiting

    // when
    controller.abort(new Error("parent aborted while waiting"))
    const result = await execution

    // then
    expect(observedSignal).toBe(controller.signal)
    expect(cancelCalls).toEqual([[TASK_ID, "parent turn aborted"]])
    expect(result.details.status).toBe("cancelled")
    expect(result.details.task_id).toBe(TASK_ID)
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain(TASK_ID)
  })

  test(" w2sig #given a child becomes terminal during parent abort #when cancellation is a noop #then execute still returns cancelled cleanly", async () => {
    // given
    const controller = new AbortController()
    let markWaiting: (() => void) | undefined
    const waiting = new Promise<void>((resolve) => {
      markWaiting = resolve
    })
    let cancelCalls = 0
    const manager = createFakeManager({
      start: started,
      waitFor: () => {
        markWaiting?.()
        return new Promise<TaskRecord>((_resolve, reject) => {
          controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true })
        })
      },
      cancelTask: (taskId) => {
        cancelCalls += 1
        return Promise.resolve({ kind: "noop", task_id: taskId, status: "completed", reason: "already completed" })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    const execution = execute("call-terminal-race", { prompt: "work", category: "quick" }, controller.signal, undefined, CTX)
    await waiting

    // when
    controller.abort(new Error("parent aborted after child completed"))
    const result = await execution

    // then
    expect(cancelCalls).toBe(1)
    expect(result.details.status).toBe("cancelled")
    expect(result.details.task_id).toBe(TASK_ID)
  })

  test(" w2sig #given a background child has started #when the parent aborts #then the child survives without cancellation", async () => {
    // given
    const controller = new AbortController()
    let cancelCalls = 0
    const manager = createFakeManager({
      start: started,
      cancelTask: () => {
        cancelCalls += 1
        return Promise.resolve({ kind: "cancelled", task_id: TASK_ID, previous_status: "running" })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    const result = await execute(
      "call-background-abort",
      { prompt: "work", category: "quick", run_in_background: true },
      controller.signal,
      undefined,
      CTX,
    )

    // when
    controller.abort(new Error("parent aborted after background return"))
    await Promise.resolve()

    // then
    expect(result.details.status).toBe("running")
    expect(result.details.run_in_background).toBe(true)
    expect(cancelCalls).toBe(0)
  })

  test(" w2sig #given a sync spawn without a signal #when the child completes #then foreground behavior is unchanged", async () => {
    // given
    let observedSignal: AbortSignal | undefined
    let cancelCalls = 0
    const manager = createFakeManager({
      start: started,
      waitFor: (_taskId, options) => {
        observedSignal = options?.signal
        return Promise.resolve(makeRecord({ task_id: TASK_ID, status: "completed", final_response: "done" }))
      },
      cancelTask: () => {
        cancelCalls += 1
        return Promise.resolve({ kind: "cancelled", task_id: TASK_ID, previous_status: "running" })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))

    // when
    const result = await execute("call-no-signal", { prompt: "work", category: "quick" }, undefined, undefined, CTX)

    // then
    expect(observedSignal).toBeUndefined()
    expect(cancelCalls).toBe(0)
    expect(result.details.status).toBe("completed")
    const text = result.content[0]?.type === "text" ? result.content[0].text : ""
    expect(text).toContain("done")
  })
})
