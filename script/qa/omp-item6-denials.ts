import assert from "node:assert/strict"

import type { AgentToolResult } from "@code-yeongyu/senpi"
import type { TaskToolDetails } from "../../packages/senpi-task/src/tools/task/types"
import { createWorkpoolStore } from "../../packages/senpi-task/src/workpool/store"
import { openChildEnv, openProducerKernel } from "./omp-item6-harness"

const DEFINE_CELL = [
  "tool(async function fixture_lookup(key) { return 'parent-state:' + key; });",
  "return await tool.hold({});",
].join("\n")

/**
 * Every refusal path for item 6: curated read-only agents, a REAL process-mode agent, a parent with
 * no live JavaScript kernel, normalized collisions, reserved aliases, undefined descriptors and the
 * two agent shapes whose own policy takes a write-capable tool away. None of them may create a task
 * record, a child session, a pool - or reach the parent closure even once.
 */
export async function runCuratedProcessAndLanguageDenials(): Promise<Record<string, unknown>> {
  const kernel = await openProducerKernel("omp-item6-denials")
  const env = await openChildEnv(() => ({ text: "UNEXPECTED_CHILD_TURN" }))
  try {
    const cell = kernel.run({ cellId: "omp-item6-define", code: DEFINE_CELL })
    const hold = await kernel.nextToolCall()
    assert.equal(hold.toolName, "hold")

    const execute = async (params: Record<string, unknown>, capability: unknown): Promise<TaskToolDetails> =>
      ((await env.taskTool.execute(
        "omp-item6-denial",
        params as never,
        undefined,
        undefined,
        env.context(capability as never) as never,
      )) as AgentToolResult<TaskToolDetails>).details

    const base = { prompt: "use the parent tool", run_in_background: true as const }
    const cases: { readonly label: string; readonly details: TaskToolDetails }[] = [
      { label: "curated-read-only-agent", details: await execute({ ...base, subagent_type: "explore", tools: ["fixture_lookup"] }, kernel.capability) },
      { label: "non-js-parent-no-capability", details: await execute({ ...base, category: "quick", tools: ["fixture_lookup"] }, undefined) },
      { label: "reserved-alias", details: await execute({ ...base, category: "quick", tools: ["task_send"] }, kernel.capability) },
      { label: "normalized-collision", details: await execute({ ...base, category: "quick", tools: ["fixture-lookup", "fixture_lookup"] }, kernel.capability) },
      { label: "missing-descriptor", details: await execute({ ...base, category: "quick", tools: ["never_defined"] }, kernel.capability) },
      // A REAL process-mode child: the agent definition routes the spawn to the rpc runner.
      { label: "process-mode-agent", details: await execute({ ...base, subagent_type: "rpc-worker", tools: ["fixture_lookup"] }, kernel.capability) },
      // The two supported ways an agent takes `write` away. `probe-no-write` resolves to an EMPTY
      // allowlist, which is the most restrictive shape and must never read as "no policy".
      { label: "empty-allowlist-agent", details: await execute({ ...base, subagent_type: "probe-no-write", tools: ["fixture_lookup"] }, kernel.capability) },
      { label: "deny-only-agent", details: await execute({ ...base, subagent_type: "restricted-writer", tools: ["fixture_lookup"] }, kernel.capability) },
    ]
    for (const entry of cases) {
      assert.ok(entry.details.kernel_tools?.error, `${entry.label} must be a typed refusal`)
      assert.equal(entry.details.kernel_tools?.status, "refused", `${entry.label} must not claim a grant`)
      assert.equal(entry.details.kernel_tools?.granted, undefined, `${entry.label} must not report granted names`)
      assert.equal(entry.details.status, "denied", `${entry.label} must not spawn`)
    }
    assert.deepEqual(env.store.list().records, [], "no task record may exist after a grant refusal")
    assert.equal(env.sessions.length, 0, "no child session may exist after a grant refusal")
    assert.deepEqual(kernel.invocations(), { attempted: 0, succeeded: 0 }, "a refused grant may never reach the parent closure")

    const context = env.context(kernel.capability)
    const pool = (await env.workpoolTool.execute(
      "omp-item6-pool-denied",
      { op: "create", name: "denied-pool", agent: { category: "quick", prompt: "x" }, tools: ["never_defined"] } as never,
      undefined,
      undefined,
      context as never,
    )).details as { error?: { code: string } }
    assert.equal(pool.error?.code, "kernel_tool_missing")
    assert.deepEqual(createWorkpoolStore(env.store.stateDir).list(), [], "a refused pool must not be created")

    // The nested-host-scope refusals above are decided at the TOOL layer, before any record: the
    // closure a granted child could call runs with the PARENT's permissions, and these children's
    // own policy removes a write-capable tool the closure can still reach.
    const narrowed = cases.filter((entry) => entry.label === "empty-allowlist-agent" || entry.label === "deny-only-agent")
    for (const entry of narrowed) {
      assert.equal(entry.details.kernel_tools?.error?.code, "tools_unavailable", `${entry.label} must be typed tools_unavailable`)
      assert.equal(entry.details.task_id, "", `${entry.label} must not create a task`)
    }

    kernel.reply(hold.callId, "released")
    await cell
    return {
      passed: true,
      producer_sha: kernel.sha,
      denials: cases.map((entry) => ({
        case: entry.label,
        code: entry.details.kernel_tools?.error?.code,
        kernel_tools_status: entry.details.kernel_tools?.status,
        status: entry.details.status,
        task_id: entry.details.task_id,
      })),
      pool_denial: pool.error,
      child_sessions_opened: env.sessions.length,
      task_records_created: env.store.list().records.length,
      kernel_invocations: kernel.invocations(),
    }
  } finally {
    env.dispose()
    await kernel.close()
  }
}
