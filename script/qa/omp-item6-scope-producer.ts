import assert from "node:assert/strict"

import type { AgentToolResult } from "@code-yeongyu/senpi"
import type { TaskToolDetails } from "../../packages/senpi-task/src/tools/task/types"
import { bounded, openChildEnv, openProducerKernel, type ProducerKernel } from "./omp-item6-harness"

/**
 * The same scoped grant as `omp-item6-scope.ts`, but against the REAL merged producer kernel
 * (senpi#1731 / senpi PR #1765) injected through `OMP_SENPI_PRODUCER`: the scope omo computes is
 * enforced inside the producer's own worker, so the refusal is the engine's, not a fixture's.
 *
 * A real JS cell defines one closure that reaches a host tool by name. A REAL in-process child with
 * a denylist of its own calls it twice - once for a tool it still has, once for the tool it gave up.
 */
const PARENT_CELL = [
  "tool(async function fixture_probe(which) { return which === 'write' ? await tool.write({ path: 'x' }) : await tool.read({ path: 'config.txt' }); });",
  "return await tool.hold({});",
].join("\n")

const RESTRICTED = "restricted-writer"
const EXPECTED_SCOPE = { tools: { allow: ["read", "bash", "edit", "grep"], deny: ["write"] } }

type PumpedCall = { readonly toolName: string; readonly callId: string }

/** Answer every nested host call the parent closure actually reaches. */
function pumpNestedCalls(kernel: ProducerKernel, seen: PumpedCall[], stopped: { value: boolean }): void {
  void (async () => {
    while (!stopped.value) {
      let call: PumpedCall
      try {
        call = await kernel.nextToolCall()
      } catch {
        return
      }
      seen.push({ toolName: call.toolName, callId: call.callId })
      kernel.reply(call.callId, "nested-body")
    }
  })()
}

/** The child drives itself: the tool it kept, then the tool its own policy took away. */
function childTurn(body: string) {
  if (body.includes("kernel_tool_host_denied")) return { text: "CHILD_SAW kernel_tool_host_denied" }
  if (body.includes("nested-body")) return { toolName: "fixture_probe", args: { which: "write" } }
  return { toolName: "fixture_probe", args: { which: "read" } }
}

export async function runProducerScopedNarrowedChild(): Promise<Record<string, unknown>> {
  const kernel = await openProducerKernel("omp-b2-producer-scope")
  const env = await openChildEnv(childTurn, {
    planner: (spec) => ({
      kind: "resolved",
      plan: {
        model: "omp-fixture/fixture",
        ...(spec.subagent_type === RESTRICTED ? { agentType: RESTRICTED, toolDenylist: ["write"] } : {}),
      },
    }),
    childToolNames: ["read", "grep"],
  })
  const nested: PumpedCall[] = []
  const stopped = { value: false }
  try {
    const cell = kernel.run({ cellId: "omp-b2-producer-cell", code: PARENT_CELL })
    const hold = await bounded(kernel.nextToolCall(), "hold-call")
    assert.equal(hold.toolName, "hold")
    pumpNestedCalls(kernel, nested, stopped)

    const details = ((await env.taskTool.execute(
      "omp-b2-producer",
      {
        prompt: "Call fixture_probe for read, then for write, then report what you saw.",
        subagent_type: RESTRICTED,
        run_in_background: false,
        tools: ["fixture_probe"],
      } as never,
      undefined,
      undefined,
      env.context(kernel.capability) as never,
    )) as AgentToolResult<TaskToolDetails>).details

    assert.equal(details.kernel_tools?.status, "granted", "the real producer advertises the scope, so the narrowed child is granted")
    assert.equal(details.kernel_tools?.scoped, true)
    assert.deepEqual(details.kernel_tools?.scope, { allow: EXPECTED_SCOPE.tools.allow, deny: EXPECTED_SCOPE.tools.deny })
    assert.equal(details.status, "completed")

    const record = env.store.load(details.task_id)
    assert.ok(record)
    assert.equal(record.final_response, "CHILD_SAW kernel_tool_host_denied")

    // The real worker refused the out-of-scope nested call BEFORE the host bridge saw it.
    const hostTools = nested.map((call) => call.toolName)
    assert.ok(hostTools.includes("read"), "the allowed nested host call must reach the bridge")
    assert.ok(!hostTools.includes("write"), "the denied nested host call must never reach the bridge")
    // Two invocations were attempted; the denied one did not produce a closure value.
    const counts = kernel.invocations()
    assert.equal(counts.attempted, 2)
    assert.equal(counts.succeeded, 1)

    kernel.reply(hold.callId, "released")
    const parent = await bounded(cell, "parent-cell")
    assert.equal(parent.ok, true, "the parent's own cell must not fail for the child's refusal")

    return {
      passed: true,
      case: "producer-scoped-narrowed-child",
      producer_sha: kernel.sha,
      kernel_tools: details.kernel_tools,
      child: { task_id: details.task_id, status: record.status, final_response: record.final_response },
      nested_host_calls: hostTools,
      kernel_invocations: counts,
      parent_cell: { ok: parent.ok, value: parent.valueRepr },
    }
  } finally {
    stopped.value = true
    env.dispose()
    await kernel.close()
  }
}
