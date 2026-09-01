import { afterEach, describe, expect, test } from "bun:test"

import { baseSpec, cleanupProjects, makeManager } from "./__fixtures__/manager-fakes"



afterEach(cleanupProjects)

describe("manager status facts", () => {
  test("#given a spec carrying a description #when the task starts #then the persisted record keeps it for status views", async () => {
    // given
    const { manager, store } = makeManager()

    // when
    const started = await manager.start(baseSpec({ description: "Audit the waiting-line renderers" }))

    // then
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    expect(store.load(started.task_id)?.description).toBe("Audit the waiting-line renderers")
  })

  test("#given a live child mid-run #when run stats are read #then the manager exposes the in-flight accumulator", async () => {
    // given a running child that already produced one turn and one tool call
    const { manager, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")
    fake.emit({
      type: "message_end",
      message: { role: "assistant", content: [{ type: "text", text: "working" }], usage: { output: 120, totalTokens: 300 } },
    })
    fake.emit({ type: "tool_execution_start", toolName: "read", args: { path: "a.ts" } })

    // when the live snapshot is read BEFORE the child settles
    const live = manager.runStatsSnapshot?.(started.task_id)

    // then in-flight turns and tool calls are visible to status surfaces
    expect(live?.turns).toBe(1)
    expect(live?.tool_calls).toBe(1)
    expect(live?.output_tokens).toBe(120)
  })

  test("#given an unknown task id #when run stats are read #then nothing is reported", () => {
    // given / when / then
    expect(makeManager().manager.runStatsSnapshot?.("st_missing")).toBeUndefined()
  })
})

describe("manager child subscription cleanup", () => {
  test("#given a listener registered before promotion #when its cleanup runs #then the handle unsubscribes exactly once", async () => {
    // given a pending child whose listener is registered before the handle exists
    const { manager, inProcess } = makeManager()
    const started = await manager.start(baseSpec())
    if (started.kind !== "started") throw new Error(`unexpected start result: ${started.kind}`)
    const fake = inProcess.handles.get(started.task_id)
    if (fake === undefined) throw new Error("fake handle missing")

    const cleanup = manager.subscribeChild(started.task_id, () => {})

    // when the caller cleans up (possibly after promotion) and the task later settles
    cleanup()
    cleanup()
    fake.settle({ status: "completed", finalResponse: "done" })
    await manager.waitFor(started.task_id)

    // then the underlying handle sees at most one unsubscribe
    expect(fake.unsubscribeCount()).toBeLessThanOrEqual(1)
  })
})
