import { describe, expect, test } from "bun:test"
import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import type { ManagedChildListener, StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import type { TaskToolDetails } from "./types"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

const IDS = ["st_progress_1", "st_progress_2"] as const

type Deferred<T> = { readonly promise: Promise<T>; resolve(value: T): void }

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}

// Bounded wait on a signal: GREEN resolves through the event, RED fails with a named reason.
function withinBudget<T>(promise: Promise<T>, reason: string, budgetMs = 2_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(reason)), budgetMs)
  })
  return Promise.race([promise, deadline]).finally(() => { if (timer !== undefined) clearTimeout(timer) })
}

function text(result: AgentToolResult<TaskToolDetails>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

describe("foreground batch progress", () => {
  test("#given a foreground batch with two live children #when a child emits a tool event #then partial updates name every child and the event, then stop at completion", async () => {
    // given
    const completions = new Map<string, Deferred<TaskRecord>>(IDS.map((taskId) => [taskId, deferred<TaskRecord>()]))
    const listeners = new Map<string, ManagedChildListener>()
    const subscribed = deferred<void>()
    const unsubscribed: string[] = []
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return { kind: "started", task_id: taskId, status: "running", name: `child-${startIndex}` }
      },
      subscribeChild: (taskId, next) => {
        listeners.set(taskId, next)
        if (listeners.size === IDS.length) subscribed.resolve()
        return () => { unsubscribed.push(taskId) }
      },
      waitFor: (taskId) => completions.get(taskId)?.promise ?? Promise.reject(new Error(`unexpected wait for ${taskId}`)),
    })
    const updates: AgentToolResult<TaskToolDetails>[] = []
    const onUpdate: AgentToolUpdateCallback<TaskToolDetails> = (update) => { updates.push(update) }

    // when
    const execution = buildTaskExecute(makeDeps(manager))(
      "batch-progress",
      { category: "quick", tasks: [{ prompt: "review one" }, { prompt: "review two" }] },
      undefined,
      onUpdate,
      CTX,
    )
    await withinBudget(subscribed.promise, "foreground batch never subscribed to its children for progress")

    // then: the first snapshot already lists both children
    const initial = updates[updates.length - 1]
    expect(initial).toBeDefined()
    if (initial === undefined) throw new Error("no initial partial update")
    expect(text(initial)).toContain("child-1")
    expect(text(initial)).toContain("child-2")
    expect(initial.details).toMatchObject({ task_id: IDS[0], status: "running", run_in_background: false })
    expect(initial.details.items?.map((item) => item.task_id)).toEqual([...IDS])
    expect("progress" in initial.details).toBe(false)

    // when: one child reports a tool call
    listeners.get(IDS[0])?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })

    // then: the partial reflects the event while still listing the sibling
    const afterEvent = updates[updates.length - 1]
    if (afterEvent === undefined) throw new Error("no partial update after the child event")
    expect(text(afterEvent)).toContain("read")
    expect(text(afterEvent)).toContain("child-2")

    // when: both children finish
    for (const taskId of IDS) {
      completions.get(taskId)?.resolve(makeRecord({ task_id: taskId, status: "completed", final_response: `${taskId} done` }))
    }
    const result = await execution

    // then
    expect(text(result)).toContain("Batch completed.")
    expect(result.details.items?.map((item) => item.status)).toEqual(["completed", "completed"])
    expect([...unsubscribed].sort()).toEqual([...IDS].sort())
    const lastPartial = updates[updates.length - 1]
    if (lastPartial === undefined) throw new Error("no partial update before the final result")
    expect(text(lastPartial).match(/completed/g)?.length).toBe(2)
  })

  test("#given a foreground batch without an update sink #when it runs #then no child subscription is opened", async () => {
    // given
    let subscriptions = 0
    let startIndex = 0
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => {
        const taskId = IDS[startIndex]
        if (taskId === undefined) throw new Error("unexpected extra start")
        startIndex += 1
        return { kind: "started", task_id: taskId, status: "running", name: `child-${startIndex}` }
      },
      subscribeChild: () => {
        subscriptions += 1
        return () => {}
      },
      waitFor: async (taskId) => makeRecord({ task_id: taskId, status: "completed", final_response: "done" }),
    })

    // when
    const result = await buildTaskExecute(makeDeps(manager))(
      "batch-progress-silent",
      { category: "quick", tasks: [{ prompt: "review one" }, { prompt: "review two" }] },
      undefined,
      undefined,
      CTX,
    )

    // then
    expect(subscriptions).toBe(0)
    expect(text(result)).toContain("Batch completed.")
  })
})
