import { describe, expect, test } from "bun:test"

import { createKernelToolBindings } from "../kernel-tools/bindings"
import type { WorkpoolAggregateMessage } from "./aggregate"
import { deliveryFixture } from "./__fixtures__/delivery"
import { resolveWorkerKernelTools } from "./worker-kernel-tools"
import { WorkpoolError } from "./types"

describe("workpool workers after a stale kernel tool", () => {
  test("#given a worker that yields a stale kernel-tool error #when the pool closes #then one keyed error and one aggregate are delivered with no retry", async () => {
    const messages: WorkpoolAggregateMessage[] = []
    const f = deliveryFixture()
    f.manager.workpools.bindAggregate({ enqueue: (message, receipts) => { messages.push(message); receipts.ack() } })
    const worker = await f.start("a")
    const turnsBefore = f.turns.length

    const yielded = f.yieldResults(worker.taskId, worker.epoch, [
      { key: "a", error: { code: "kernel_tool_stale", message: "Kernel tool descriptor generation is stale" } },
    ])
    await f.settle(worker.taskId)
    f.manager.workpools.close(f.caller, f.pool.pool_id)

    expect(yielded).toMatchObject({ results: [{ key: "a", status: "accepted" }] })
    expect(f.inspect().items).toMatchObject([{ key: "a", status: "error", error: { code: "kernel_tool_stale" } }])
    expect(f.turns.length).toBe(turnsBefore)
    expect(messages).toHaveLength(1)
    expect(messages[0]?.results).toMatchObject([{ key: "a", error: { code: "kernel_tool_stale" } }])
  })

  test("#given a pool whose parent kernel binding is gone #when a new worker spawns #then the grant is refused instead of silently dropped", async () => {
    const f = deliveryFixture()
    const bindings = createKernelToolBindings()
    const pool = { ...f.inspect(), kernel_tool_names: ["fixture_lookup"] }

    const denied = await resolveWorkerKernelTools(pool, bindings).catch((error: unknown) => error)
    const none = await resolveWorkerKernelTools(f.inspect(), bindings)

    expect(denied).toBeInstanceOf(WorkpoolError)
    expect((denied as WorkpoolError).code).toBe("tools_unavailable")
    expect(none).toBeUndefined()
  })
})
