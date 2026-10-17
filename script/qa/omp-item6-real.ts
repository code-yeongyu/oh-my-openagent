import assert from "node:assert/strict"

import type { AgentToolResult } from "@code-yeongyu/senpi"
import type { TaskToolDetails } from "../../packages/senpi-task/src/tools/task/types"
import { bounded, openChildEnv, openProducerKernel, type ChildEnv, type ProducerKernel } from "./omp-item6-harness"

const PARENT_CELL = [
  "tool(async function fixture_lookup(key) { return 'parent-state:' + (await tool.read({ path: key })); });",
  "return await agent('Call fixture_lookup with key=config.txt and report its value.', { agent: 'qa-worker', tools: ['fixture_lookup'] });",
].join("\n")

type PumpedCall = { readonly toolName: string; readonly callId: string }

/** Answer every nested host call the parent closure makes while the child turn is in flight. */
function pumpNestedCalls(kernel: ProducerKernel, seen: PumpedCall[], stopped: { value: boolean }): void {
  void (async () => {
    while (!stopped.value) {
      let call: PumpedCall & { args: unknown }
      try {
        call = (await kernel.nextToolCall()) as PumpedCall & { args: unknown }
      } catch {
        return
      }
      seen.push({ toolName: call.toolName, callId: call.callId })
      kernel.reply(call.callId, "nested-body")
    }
  })()
}

function taskExecute(env: ChildEnv, capability: unknown) {
  return async (params: Record<string, unknown>): Promise<AgentToolResult<TaskToolDetails>> =>
    (await env.taskTool.execute(
      "omp-item6",
      params as never,
      undefined,
      undefined,
      env.context(capability as never) as never,
    )) as AgentToolResult<TaskToolDetails>
}

export async function runRealChildKernelTool(): Promise<Record<string, unknown>> {
  const kernel = await openProducerKernel("omp-item6-real")
  // The child asks for the parent tool first; once the real closure's value is in its transcript,
  // it answers with that exact value - so the assertion below proves the whole round trip.
  const env = await openChildEnv((body) => {
    const seen = /parent-state:[a-z-]+/.exec(body)
    return seen === null ? { toolName: "fixture_lookup", args: { key: "config.txt" } } : { text: `CHILD_SAW ${seen[0]}` }
  })
  const nested: PumpedCall[] = []
  const stopped = { value: false }
  try {
    const cell = kernel.run({ cellId: "omp-item6-parent", code: PARENT_CELL })
    const agentCall = await bounded(kernel.nextToolCall(), "agent-call")
    assert.equal(agentCall.toolName, "__agent__")
    pumpNestedCalls(kernel, nested, stopped)

    const execute = taskExecute(env, kernel.capability)
    const agentResult = await bounded(
      kernel.runEvalAgent(agentCall.args, {
        callId: "omp-item6-agent",
        taskToolName: "task",
        executeTool: async (name: string, params: Record<string, unknown>) => {
          assert.equal(name, "task")
          return await execute(params)
        },
      }),
      "agent-result",
    )
    kernel.reply(agentCall.callId, { text: agentResult.text })
    const parent = await bounded(cell, "parent-cell")

    const childSession = env.sessions.at(-1) ?? []
    const records = env.store.list().records
    const child = records.at(-1)
    assert.ok(child, "a real child record must exist")
    assert.equal(child.status, "completed")
    assert.equal(child.final_response, "CHILD_SAW parent-state:nested-body")
    assert.ok(childSession.includes("fixture_lookup"), "the child session must expose the granted parent tool")
    assert.ok(nested.some((call) => call.toolName === "read"), "the parent closure must reach the host bridge")
    assert.ok(agentResult.text.length > 0)
    assert.equal(parent.ok, true)

    const pool = await poolWorkerGrant(env, kernel)
    return {
      passed: true,
      producer_sha: kernel.sha,
      parent_cell: { ok: parent.ok, value: parent.valueRepr },
      agent_text: agentResult.text,
      child: { task_id: child.task_id, status: child.status, run_epoch: child.notification.run_epoch },
      child_tools: childSession.filter((name) => name === "fixture_lookup"),
      nested_host_calls: nested.map((call) => call.toolName),
      pool,
      persisted_spawn_spec: child.spawn_spec,
    }
  } finally {
    stopped.value = true
    env.dispose()
    await kernel.close()
  }
}

/** A pool worker created with the SAME names follows the identical resolution and grant rules. */
async function poolWorkerGrant(env: ChildEnv, kernel: ProducerKernel): Promise<Record<string, unknown>> {
  const context = env.context(kernel.capability, "omp-item6-parent")
  const create = await env.workpoolTool.execute(
    "omp-item6-pool",
    { op: "create", name: "omp-item6-pool", agent: { category: "quick", prompt: "Use fixture_lookup" }, tools: ["fixture_lookup"] } as never,
    undefined,
    undefined,
    context as never,
  )
  const details = create.details as { pool_id?: `wp_${string}`; error?: { code: string } }
  assert.equal(details.error, undefined)
  assert.ok(details.pool_id)
  const poolId = details.pool_id
  const record = env.manager.workpools.inspect({ sessionId: "omp-item6-parent", rootSessionId: "omp-item6-parent", depth: 0, cwd: env.root }, poolId)
  assert.deepEqual(record.kernel_tool_names, ["fixture_lookup"])
  assert.ok(env.kernelToolBindings.get(poolId), "the pool binding is runtime state")
  const dispatched = env.manager.workpools.waitForEvent(poolId, "dispatched", AbortSignal.timeout(20_000))
  await env.workpoolTool.execute(
    "omp-item6-push",
    { op: "push", pool_id: poolId, items: [{ key: "a", input: 1 }] } as never,
    undefined,
    undefined,
    context as never,
  )
  const event = await bounded(dispatched, "pool-dispatched")
  const workerTools = env.sessions.at(-1) ?? []
  assert.ok(workerTools.includes("fixture_lookup"), "the pool worker session must carry the freshly resolved grant")
  return {
    pool_id: poolId,
    persisted_names: record.kernel_tool_names,
    worker_task_id: event.task_id,
    worker_has_tool: workerTools.includes("fixture_lookup"),
  }
}
