import { describe, expect, test } from "bun:test"
import type { AgentToolResult, AgentToolUpdateCallback } from "@code-yeongyu/senpi"

import type { ManagedChildEvent, ManagedChildListener, StartResult } from "../../manager"
import type { TaskRecord } from "../../state"
import type { TaskToolDetails } from "./types"
import { CTX, createFakeManager, makeDeps, makeRecord } from "./__fixtures__/task-tool-fakes"
import { buildTaskExecute } from "./execute"

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolve!: (value: T) => void
  return { promise: new Promise<T>((done) => { resolve = done }), resolve }
}

function text(result: AgentToolResult<TaskToolDetails>): string {
  const content = result.content[0]
  return content?.type === "text" ? content.text : ""
}

describe("foreground task progress", () => {
  test("#given a live child #when it emits task events #then partial updates reflect child state and unsubscribe at completion", async () => {
    const completion = deferred<TaskRecord>()
    let listener: ManagedChildListener | undefined
    const subscribed = deferred<void>()
    let unsubscribed = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({ kind: "started", task_id: "st_00000001", status: "running", name: "child" }),
      subscribeChild: (_taskId, next) => {
        listener = next
        subscribed.resolve()
        return () => { unsubscribed = true }
      },
      waitFor: () => completion.promise,
    })
    const updates: AgentToolResult<TaskToolDetails>[] = []
    const onUpdate: AgentToolUpdateCallback<TaskToolDetails> = (update) => { updates.push(update) }
    const execution = buildTaskExecute(makeDeps(manager))(
      "call-1",
      { prompt: "inspect", category: "quick" },
      undefined,
      onUpdate,
      CTX,
    )

    await subscribed.promise
    expect(listener).toBeDefined()
    listener?.({ type: "tool_execution_start", toolName: "read", args: { path: "src/foo.ts" } })
    listener?.({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "I found the relevant implementation." }] },
    })
    expect(updates.length).toBeGreaterThanOrEqual(2)
    expect(text(updates.at(-1)!)).toContain("running read src/foo.ts")

    completion.resolve(makeRecord({ task_id: "st_00000001", status: "completed", final_response: "final" }))
    const final = await execution
    const updatesAtCompletion = updates.length
    listener?.({ type: "tool_execution_start", toolName: "bash", args: { command: "should not stream" } })

    expect(text(final)).toContain("final")
    expect(text(updates.at(-1)!)).toContain("last: I found the relevant implementation.")
    expect(unsubscribed).toBe(true)
    expect(updates).toHaveLength(updatesAtCompletion)
  })

  test("#given a queued child #when it is promoted #then it emits queued progress then attaches at promotion", async () => {
    const completion = deferred<TaskRecord>()
    let pendingListener: ManagedChildListener | undefined
    const subscribed = deferred<void>()
    let unsubscribed = false
    const manager = createFakeManager({
      start: async (): Promise<StartResult> => ({
        kind: "started", task_id: "st_00000002", status: "pending", name: "queued", queue_position: 1,
      }),
      subscribeChild: (_taskId, listener) => {
        pendingListener = listener
        subscribed.resolve()
        return () => { unsubscribed = true }
      },
      waitFor: () => completion.promise,
    })
    const updates: AgentToolResult<TaskToolDetails>[] = []
    const execution = buildTaskExecute(makeDeps(manager))(
      "call-2",
      { prompt: "inspect", category: "quick" },
      undefined,
      (update) => { updates.push(update) },
      CTX,
    )

    await subscribed.promise
    expect(text(updates[0]!)).toBe("queued · waiting for slot")
    pendingListener?.({ type: "tool_execution_start", toolName: "grep", args: { pattern: "TODO" } })
    expect(text(updates.at(-1)!)).toContain("running grep TODO")

    completion.resolve(makeRecord({ task_id: "st_00000002", status: "completed", final_response: "done" }))
    await execution
    expect(unsubscribed).toBe(true)
  })
})
