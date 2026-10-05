import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import type { WorkpoolAggregateMessage } from "../../packages/senpi-task/src/workpool/aggregate"
import type { WorkpoolEvent } from "../../packages/senpi-task/src/workpool/types"
import { definedKernel } from "./omp-item6-kernel-cell"
import { bounded, openChildEnv, type ChildEnv } from "./omp-item6-harness"

const POOL_KEY = "a"

/** The worker's OWN tool-result channel, read back from its real JSONL transcript. */
function workerToolResults(env: ChildEnv, taskId: string): readonly string[] {
  const dir = join(env.store.stateDir, "children", taskId, "sessions", taskId)
  return readdirSync(dir).flatMap((file) => readFileSync(join(dir, file), "utf8").split("\n"))
    .filter((line) => line.includes("\"kernel_tool\":\"fixture_lookup\""))
}

function workpoolTool(env: ChildEnv, context: unknown) {
  return async (callId: string, params: Record<string, unknown>): Promise<Record<string, unknown>> =>
    (await env.workpoolTool.execute(callId, params as never, undefined, undefined, context as never))
      .details as Record<string, unknown>
}

/**
 * A REAL pool worker receives `kernel_tool_stale` on its OWN tool channel and then yields it.
 *
 * The parent kernel is reset from inside the worker's first provider turn - the worker session (and
 * its freshly resolved grant) already exist at that point, and the reset is awaited before the turn
 * answers, so the ordering is causal rather than timed. The pool must then record exactly one keyed
 * error and deliver exactly one aggregate, with no re-dispatch of the item.
 */
export async function runPoolWorkerStaleYield(): Promise<Record<string, unknown>> {
  const { kernel, release } = await definedKernel("omp-item6-pool-stale")
  let reset: Promise<void> | undefined
  const env = await openChildEnv(async (body) => {
    if (body.includes("accepted")) return { text: "WORKER_YIELDED_STALE" }
    if (body.includes("kernel_tool_stale")) {
      return {
        toolName: "workpool",
        args: { op: "yield", results: [{ key: POOL_KEY, error: { code: "kernel_tool_stale", message: "parent kernel tool is stale" } }] },
      }
    }
    // The worker exists and holds its grant: reset the parent kernel now, then call the tool.
    reset ??= kernel.reset()
    await reset
    return { toolName: "fixture_lookup", args: { key: "config.txt" } }
  })
  const dispatches: WorkpoolEvent[] = []
  const unsubscribe = env.manager.workpools.subscribe((event) => {
    if (event.kind === "dispatched") dispatches.push(event)
  })
  const aggregates: WorkpoolAggregateMessage[] = []
  env.manager.workpools.bindAggregate({ enqueue: (message, receipts) => { aggregates.push(message); receipts.ack() } })
  try {
    const context = env.context(kernel.capability, "omp-item6-parent")
    const pool = workpoolTool(env, context)
    const created = await pool("omp-item6-stale-create", {
      op: "create", name: "omp-item6-stale-pool", agent: { category: "quick", prompt: "Use fixture_lookup" }, tools: ["fixture_lookup"],
    })
    const poolId = created["pool_id"]
    assert.equal(created["error"], undefined)
    assert.ok(typeof poolId === "string" && poolId.length > 0, "the pool must be created with its parent tool")

    const dispatched = env.manager.workpools.waitForEvent(poolId as `wp_${string}`, "dispatched", AbortSignal.timeout(20_000))
    const settled = env.manager.workpools.waitForEvent(poolId as `wp_${string}`, "item_result", AbortSignal.timeout(20_000))
    await pool("omp-item6-stale-push", { op: "push", pool_id: poolId, items: [{ key: POOL_KEY, input: 1 }] })
    const dispatchEvent = await bounded(dispatched, "pool-dispatched")
    const workerTools = env.sessions.at(-1) ?? []
    assert.ok(workerTools.includes("fixture_lookup"), "the worker session must carry the freshly resolved grant")
    await bounded(settled, "pool-item-result")

    const inspected = await pool("omp-item6-stale-close", { op: "close", pool_id: poolId })
    const items = (inspected["items"] ?? []) as readonly { key: string; status: string; error?: { code: string } }[]
    const keyedErrors = items.filter((item) => item.status === "error")
    assert.equal(keyedErrors.length, 1, "exactly one keyed error")
    assert.equal(keyedErrors[0]?.error?.code, "kernel_tool_stale")
    assert.equal(aggregates.length, 1, "exactly one aggregate")
    assert.equal(dispatches.length, 1, "a stale tool error must not re-dispatch the item")
    const attempts = kernel.invocations()
    assert.equal(attempts.succeeded, 0, "the stale invocation must not run the closure")
    assert.ok(attempts.attempted >= 1, "the worker really called the parent capability")
    const workerTaskId = dispatchEvent.task_id
    assert.ok(workerTaskId !== undefined, "the dispatch event must identify the worker")
    const channel = workerToolResults(env, workerTaskId)
    assert.ok(
      channel.some((line) => line.includes("kernel_tool_stale")),
      "the worker's own tool-result channel must carry the typed stale error",
    )

    return {
      pool_id: poolId,
      worker_task_id: workerTaskId,
      worker_channel_stale_results: channel.filter((line) => line.includes("kernel_tool_stale")).length,
      keyed_errors: keyedErrors,
      aggregate_count: aggregates.length,
      aggregate_results: aggregates[0]?.results,
      dispatch_count: dispatches.length,
      kernel_invocations: attempts,
    }
  } finally {
    unsubscribe()
    release()
    env.dispose()
    await kernel.close()
  }
}
