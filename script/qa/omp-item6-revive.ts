import assert from "node:assert/strict"

import type { AgentToolResult, ToolDefinition } from "@code-yeongyu/senpi"
import { createKernelToolBindings } from "../../packages/senpi-task/src/kernel-tools/bindings"
import { InProcessRunner } from "../../packages/senpi-task/src/runners/in-process"
import { runTaskSend } from "../../packages/senpi-task/src/tools/control/send"
import type { TaskToolDetails } from "../../packages/senpi-task/src/tools/task/types"
import { definedKernel } from "./omp-item6-kernel-cell"
import { runPoolWorkerStaleYield } from "./omp-item6-pool-stale"
import { bounded, openChildEnv, type ChildEnv, type ProducerKernel } from "./omp-item6-harness"

const REVIVE_MARKER = "REVIVED_TURN_MARKER"

/**
 * Each turn calls the granted tool once and then answers with what THAT turn produced. The scope is
 * cut at the last revive marker so an earlier successful turn in the same transcript can never be
 * mistaken for the current turn's result.
 */
function childTurn(body: string) {
  const marker = body.lastIndexOf(REVIVE_MARKER)
  const scope = marker === -1 ? body : body.slice(marker)
  // The envelope arrives JSON-escaped inside the request body, so match the bare code token.
  const failure = /(kernel_tool_stale|tools_unavailable|kernel_tool_missing)/.exec(scope)
  if (failure !== null) return { text: `CHILD_SAW_ERROR ${failure[1]}` }
  const value = /parent-state:[a-z0-9.]+/.exec(scope)
  if (value !== null) return { text: `CHILD_SAW ${value[0]}` }
  return { toolName: "fixture_lookup", args: { key: "config.txt" } }
}

async function spawn(env: ChildEnv, kernel: ProducerKernel, name: string): Promise<TaskToolDetails> {
  const result = (await env.taskTool.execute(
    `omp-item6-${name}`,
    { prompt: "Call fixture_lookup with key=config.txt and report its value.", subagent_type: "qa-worker", run_in_background: false, tools: ["fixture_lookup"] } as never,
    undefined,
    undefined,
    env.context(kernel.capability) as never,
  )) as AgentToolResult<TaskToolDetails>
  return result.details
}


export async function runParkedChildLiveKernel(): Promise<Record<string, unknown>> {
  const { kernel, release } = await definedKernel("omp-item6-parked")
  const env = await openChildEnv(childTurn, { idleTimeoutMs: 50 })
  try {
    const details = await spawn(env, kernel, "parked")
    assert.equal(details.status, "completed")
    const taskId = details.task_id
    assert.equal(env.store.load(taskId)?.final_response, "CHILD_SAW parent-state:config.txt")

    // Same-host idle parking must keep the runtime binding alive.
    const parked = await env.park(taskId)
    assert.equal(parked.state, "persisted_only")
    assert.ok(env.kernelToolBindings.get(taskId), "the binding must survive same-host parking")

    const revived = await runTaskSend(env.manager, { to: taskId, message: `${REVIVE_MARKER} Call fixture_lookup again for config.txt.` }, "omp-item6-parent")
    assert.equal(revived.details.kind, "revived")
    const terminal = await bounded(env.manager.waitFor(taskId, { signal: AbortSignal.timeout(20_000) }), "revived-terminal")
    assert.equal(terminal.status, "completed")
    assert.equal(terminal.final_response, "CHILD_SAW parent-state:config.txt")
    assert.equal(terminal.notification.run_epoch, 1)

    // A NEW spawn after an explicit same-name redefinition gets the NEW descriptor and succeeds.
    const redefine = kernel.run({
      cellId: "omp-item6-redefine",
      code: "tool(async function fixture_lookup(key) { return 'parent-state:' + key + '.v2'; }); return 'redefined';",
    })
    assert.equal((await bounded(redefine, "redefinition")).ok, true)
    const afterRedefinition = await spawn(env, kernel, "redefined")
    assert.equal(afterRedefinition.status, "completed")
    assert.equal(env.store.load(afterRedefinition.task_id)?.final_response, "CHILD_SAW parent-state:config.txt.v2")

    return {
      passed: true,
      producer_sha: kernel.sha,
      parked: { task_id: taskId, residency_state: parked.state, reclaimed: parked.reclaimed, binding_retained: true },
      revived: { kind: revived.details.kind, status: terminal.status, run_epoch: terminal.notification.run_epoch, final_response: terminal.final_response },
      after_redefinition: { task_id: afterRedefinition.task_id, final_response: env.store.load(afterRedefinition.task_id)?.final_response },
      persisted_spawn_spec: env.store.load(taskId)?.spawn_spec,
    }
  } finally {
    release()
    env.dispose()
    await kernel.close()
  }
}

export async function runRevivedChildStaleKernel(): Promise<Record<string, unknown>> {
  const { kernel, release } = await definedKernel("omp-item6-stale")
  const env = await openChildEnv(childTurn, { idleTimeoutMs: 50 })
  try {
    const details = await spawn(env, kernel, "stale")
    const taskId = details.task_id
    assert.equal((await env.park(taskId)).state, "persisted_only")

    // A real kernel reset bumps the generation, so the fenced descriptor is stale on the next call.
    const beforeReset = kernel.invocations()
    await kernel.reset()
    const revived = await runTaskSend(env.manager, { to: taskId, message: `${REVIVE_MARKER} Call fixture_lookup again.` }, "omp-item6-parent")
    assert.equal(revived.details.kind, "revived")
    const terminal = await bounded(env.manager.waitFor(taskId, { signal: AbortSignal.timeout(20_000) }), "stale-terminal")
    assert.equal(terminal.final_response, "CHILD_SAW_ERROR kernel_tool_stale")

    // A new host process has no binding at all: only a typed stub is restored from the transcript.
    const sessionPath = `${env.store.stateDir}/children/${taskId}/sessions/${taskId}/${(await import("node:fs")).readdirSync(`${env.store.stateDir}/children/${taskId}/sessions/${taskId}`)[0]}`
    const restartedTools: ToolDefinition[] = []
    const restarted = new InProcessRunner({ kernelToolBindings: createKernelToolBindings(), createSession: async (options) => {
      restartedTools.push(...(options.customTools ?? []))
      return { sessionId: "restarted", prompt: async () => undefined, steer: async () => undefined, followUp: async () => undefined, abort: async () => undefined, subscribe: () => () => undefined, getLastAssistantText: () => undefined, dispose: () => undefined }
    } })
    const handle = await restarted.resume({
      taskId, cwd: env.root, sessionDir: `${env.store.stateDir}/children/${taskId}/sessions/${taskId}/`,
      depth: 1, parentSessionId: "omp-item6-parent", rootSessionId: "omp-item6-parent", prompt: "",
    }, sessionPath)
    assert.ok(handle)
    const stubTool = restartedTools.find((tool) => tool.name === "fixture_lookup")
    assert.ok(stubTool, "the restarted host restores a named stub")

    // Invoke the restored stub ONCE: the child must read a typed refusal on its own tool channel,
    // and the stub must never reach a closure - the counter below proves it never called invoke.
    const beforeStub = kernel.invocations()
    const stubResult = (await stubTool.execute("omp-item6-stub", {} as never, undefined, undefined, {} as never)) as {
      readonly isError?: boolean
      readonly details?: { readonly error?: { readonly code?: string } }
    }
    const stubInvocations = kernel.invocationsSince(beforeStub)
    assert.equal(stubResult.isError, true)
    assert.equal(stubResult.details?.error?.code, "tools_unavailable")
    assert.deepEqual(stubInvocations, { attempted: 0, succeeded: 0 }, "a restored stub must never invoke a closure")

    const stub = (await import("../../packages/senpi-task/src/kernel-tools/transcript-names")).recordedKernelToolNames(sessionPath)
    assert.deepEqual(stub, ["fixture_lookup"])

    const afterReset = kernel.invocationsSince(beforeReset)
    assert.equal(afterReset.succeeded, 0, "no closure may run after the parent kernel reset")

    const pool = await runPoolWorkerStaleYield()

    return {
      passed: true,
      producer_sha: kernel.sha,
      stale_after_reset: { task_id: taskId, final_response: terminal.final_response, run_epoch: terminal.notification.run_epoch },
      restarted_host: {
        restored_stub_names: stub,
        no_binding: true,
        stub_result_code: stubResult.details?.error?.code,
        stub_kernel_invocations: stubInvocations,
      },
      kernel_invocations_after_reset: afterReset.succeeded,
      kernel_invocation_attempts_after_reset: afterReset.attempted,
      pool_worker_stale_yield: pool,
    }
  } finally {
    release()
    env.dispose()
    await kernel.close()
  }
}
