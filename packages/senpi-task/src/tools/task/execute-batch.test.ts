import { describe, expect, test } from "bun:test"

import type { StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

const IDS = ["st_batch_1", "st_batch_2", "st_batch_3"]
function textOf(result: Awaited<ReturnType<ReturnType<typeof buildTaskExecute>>>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}
function started(taskId: string, name: string, status: "running" | "pending" = "running", queuePosition?: number): StartResult {
  return {
    kind: "started",
    task_id: taskId,
    status,
    name,
    ...(queuePosition === undefined ? {} : { queue_position: queuePosition }),
  }
}
function startFailed(taskId: string, name: string, message: string): StartResult {
  return {
    kind: "start_failed",
    task_id: taskId,
    name,
    category: "quick",
    execution_mode: "in-process",
    model: "test/model",
    run_in_background: true,
    error_message: message,
  }
}

describe("buildTaskExecute batch fanout", () => {
  test(" w2batch #given three sync items #when all complete #then details preserve input order with aggregate completed", async () => {
    // given
    let startIndex = 0
    const manager = createFakeManager({
      start: async (spec): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return started(taskId, spec.name ?? `item-${startIndex}`)
      },
      waitFor: async (taskId): Promise<TaskRecord> =>
        makeRecord({ task_id: taskId, status: "completed", final_response: `done:${taskId}` }),
    })
    const execute = buildTaskExecute(makeDeps(manager))
    // when
    const output = await execute(
      "batch-complete",
      { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )
    // then
    expect(output.details.status).toBe("completed")
    expect(output.details.items).toMatchObject(IDS.map((task_id) => ({ task_id, status: "completed" })))
  })

  test(" w2batch #given one runner error #when the sync batch settles #then both successes remain and aggregate status is error", async () => {
    // given
    let startIndex = 0
    const waited: string[] = []
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return started(taskId, `item-${startIndex}`)
      },
      waitFor: async (taskId): Promise<TaskRecord> => {
        waited.push(taskId)
        return taskId === IDS[1]
          ? makeRecord({ task_id: taskId, status: "error", error_message: "runner exploded" })
          : makeRecord({ task_id: taskId, status: "completed", final_response: `done:${taskId}` })
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    // when
    const output = await execute(
      "batch-partial",
      { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )
    // then
    expect(waited).toEqual(IDS)
    expect(output.details.status).toBe("error")
    expect(output.details.items).toMatchObject([
      { task_id: IDS[0], status: "completed" },
      { task_id: IDS[1], status: "error", error_message: "runner exploded" },
      { task_id: IDS[2], status: "completed" },
    ])
  })

  test(" w2batch #given an oversized batch #when executed #then it rejects before starting any item", async () => {
    // given
    let startCalls = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        startCalls += 1
        throw new Error("batch start must not run")
      },
    })
    const tasks = Array.from({ length: 17 }, () => ({ prompt: "one" }))

    // when
    const output = await buildTaskExecute(makeDeps(manager))(
      "oversized-batch", { category: "quick", tasks }, undefined, undefined, CTX,
    )

    // then
    expect(startCalls).toBe(0)
    expect(output.details).toMatchObject({ task_id: "", status: "invalid_arguments", mode: "spawn" })
  })

  test(" w2batch #given a thrown middle start #when later items can start #then every item outcome is preserved", async () => {
    // given
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const index = startIndex
        startIndex += 1
        if (index === 1) throw new Error("middle start exploded")
        const taskId = IDS[index]
        if (taskId === undefined) throw new Error("unexpected extra start")
        return started(taskId, `item-${index + 1}`)
      },
      waitFor: async (taskId): Promise<TaskRecord> =>
        makeRecord({ task_id: taskId, status: "completed", final_response: `done:${taskId}` }),
    })

    // when
    const output = await buildTaskExecute(makeDeps(manager))(
      "throwing-batch", { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] }, undefined, undefined, CTX,
    )

    // then
    expect(startIndex).toBe(3)
    expect(output.details.status).toBe("error")
    expect(output.details.items).toMatchObject([
      { task_id: IDS[0], status: "completed" },
      { task_id: "", status: "error", error_message: "middle start exploded" },
      { task_id: IDS[2], status: "completed" },
    ])
  })

  test(" w2batch #given background capacity one #when three items start #then all ids and queue positions return as running", async () => {
    // given
    const starts = [started(IDS[0], "one"), started(IDS[1], "two", "pending", 1), started(IDS[2], "three", "pending", 2)]
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const next = starts[startIndex]
        if (next === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return next
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    // when
    const output = await execute(
      "batch-background",
      { category: "quick", run_in_background: true, tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )
    // then
    expect(output.details).toMatchObject({ task_id: IDS[0], status: "running", run_in_background: true })
    expect(output.details.items).toEqual([
      { task_id: IDS[0], name: "one", status: "running" },
      { task_id: IDS[1], name: "two", status: "pending", queue_position: 1 },
      { task_id: IDS[2], name: "three", status: "pending", queue_position: 2 },
    ])
    for (const taskId of IDS) expect(textOf(output)).toContain(`task_send(to="${taskId}"`)
  })

  test(" w2batch #given a parent abort during three waits #when the batch settles #then every non-terminal child is cancelled", async () => {
    // given
    const controller = new AbortController()
    const abortReason = new Error("stop the batch")
    let startIndex = 0
    let waitCalls = 0
    const cancelled: string[] = []
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return started(taskId, `item-${startIndex}`)
      },
      waitFor: (taskId, options) => {
        waitCalls += 1
        if (waitCalls === 1) queueMicrotask(() => controller.abort(abortReason))
        return new Promise<TaskRecord>((_resolve, reject) => {
          const signal = options?.signal
          if (signal === undefined) throw new Error("expected abort signal")
          if (signal.aborted) {
            reject(signal.reason)
            return
          }
          signal.addEventListener("abort", () => reject(signal.reason), { once: true })
        })
      },
      cancelTask: async (taskId) => {
        cancelled.push(taskId)
        return { kind: "cancelled", task_id: taskId, previous_status: "running" }
      },
    })
    const execute = buildTaskExecute(makeDeps(manager))
    // when
    const output = await execute(
      "batch-abort",
      { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      controller.signal,
      undefined,
      CTX,
    )
    // then
    expect(waitCalls).toBe(3)
    expect(cancelled).toEqual(IDS)
    expect(output.details.status).toBe("cancelled")
    expect(output.details.items?.map((item) => item.status)).toEqual(["cancelled", "cancelled", "cancelled"])
  })

  test(" w2batch #given one tasks item #when compared with a legacy prompt #then the single-spawn result is identical", async () => {
    // given
    const makeManager = () => createFakeManager({
      start: async (): Promise<StartResult> => started(IDS[0], "only"),
      waitFor: async (): Promise<TaskRecord> =>
        makeRecord({ task_id: IDS[0], status: "completed", final_response: "same answer", category: "quick", name: "only" }),
    })
    // when
    const legacy = await buildTaskExecute(makeDeps(makeManager()))(
      "single-legacy", { prompt: "only", category: "quick" }, undefined, undefined, CTX,
    )
    const batched = await buildTaskExecute(makeDeps(makeManager()))(
      "single-array", { tasks: [{ prompt: "only", category: "quick" }] }, undefined, undefined, CTX,
    )
    // then
    expect(batched).toEqual(legacy)
  })

  test(" w2batch #given one denied item #when other sync items complete #then denial has an empty id and aggregate error", async () => {
    // given
    const starts: readonly StartResult[] = [
      started(IDS[0], "one"),
      { kind: "depth_denied", reason: "depth limit", child_depth: 2, max_depth: 1 },
      started(IDS[2], "three"),
    ]
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const next = starts[startIndex]
        if (next === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return next
      },
      waitFor: async (taskId): Promise<TaskRecord> => makeRecord({ task_id: taskId, status: "completed" }),
    })
    // when
    const output = await buildTaskExecute(makeDeps(manager))(
      "batch-denial",
      { category: "quick", tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )
    // then
    expect(output.details.status).toBe("error")
    expect(output.details.items?.[1]).toEqual({ task_id: "", status: "error", error_message: "depth limit" })
  })

  test(" w2batch #given every background start fails #when results are aggregated #then status is error instead of running", async () => {
    // given
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return startFailed(taskId, `item-${startIndex}`, `failed:${taskId}`)
      },
    })
    // when
    const output = await buildTaskExecute(makeDeps(manager))(
      "batch-all-failed",
      { category: "quick", run_in_background: true, tasks: [{ prompt: "one" }, { prompt: "two" }, { prompt: "three" }] },
      undefined,
      undefined,
      CTX,
    )
    // then
    expect(output.details.task_id).toBe("")
    expect(output.details.status).toBe("error")
    expect(output.details.items?.map((item) => item.error_message)).toEqual(IDS.map((taskId) => `failed:${taskId}`))
  })
})
