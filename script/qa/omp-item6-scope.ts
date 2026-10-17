import assert from "node:assert/strict"

import type { AgentToolResult } from "@code-yeongyu/senpi"
import { fakeKernelTools, type FakeKernelToolsCapability } from "../../packages/senpi-task/src/runners/in-process/__fixtures__/kernel-tools-fakes"
import type { TaskToolDetails } from "../../packages/senpi-task/src/tools/task/types"
import { openChildEnv, type ChildEnv } from "./omp-item6-harness"

/**
 * Real-transport QA for the invoke-scope consumer (oh-my-openagent#8226, senpi#1731/#1765).
 *
 * A REAL in-process child - real planner, real senpi agent session, real provider loop over a
 * loopback server - is spawned by the REAL task tool with a narrowed tool policy and a request for
 * a parent kernel tool. The parent capability is a structural fake that advertises the producer's
 * `capabilities.invokeScope` marker, records the exact options each `invoke` receives, and enforces
 * the scope on nested host calls the same way the producer does. Nothing here is injected into the
 * child: it decides its own tool calls, and the assertion reads what the child actually reported.
 */

// The child's real effective host surface: senpi session builtins (this env shares no parent tools)
// minus the agent's denylist. This is exactly what must ride on every invoke.
const EXPECTED_ALLOW = ["read", "bash", "edit", "grep"]
const EXPECTED_SCOPE = { tools: { allow: EXPECTED_ALLOW, deny: ["write"] } }

const RESTRICTED = "restricted-writer"

function scopedCapability(marker: boolean): FakeKernelToolsCapability {
  const capability = fakeKernelTools(marker ? { invokeScope: true } : {})
  // Two parent closures: one whose nested host call the child still may cause, one whose nested
  // call the child's own policy took away.
  capability.define({ name: "fixture_read_probe", run: (_args, host) => host("read") })
  capability.define({ name: "fixture_write_probe", run: (_args, host) => host("write") })
  return capability
}

/** The child drives itself: read probe, then write probe, then it reports what it saw. */
function childTurn(body: string) {
  if (body.includes("kernel_tool_host_denied")) return { text: "CHILD_SAW kernel_tool_host_denied" }
  if (body.includes("host:read")) return { toolName: "fixture_write_probe", args: {} }
  return { toolName: "fixture_read_probe", args: {} }
}

function narrowedEnv(turn: (body: string) => { toolName?: string; args?: Record<string, unknown>; text?: string }) {
  return openChildEnv(turn, {
    // The agent's own policy rides the plan, exactly as omo's planner resolves `disallowedTools`.
    planner: (spec) => ({
      kind: "resolved",
      plan: {
        model: "omp-fixture/fixture",
        ...(spec.subagent_type === RESTRICTED ? { agentType: RESTRICTED, toolDenylist: ["write"] } : {}),
      },
    }),
    // Align the parent's view of the child surface with the runner's: no shared parent tools here.
    childToolNames: ["read", "grep"],
  })
}

async function spawn(env: ChildEnv, capability: unknown, callId: string): Promise<TaskToolDetails> {
  const result = (await env.taskTool.execute(
    callId,
    {
      prompt: "Call fixture_read_probe, then call fixture_write_probe, then report what you saw.",
      subagent_type: RESTRICTED,
      run_in_background: false,
      tools: ["fixture_read_probe", "fixture_write_probe"],
    } as never,
    undefined,
    undefined,
    env.context(capability as never) as never,
  )) as AgentToolResult<TaskToolDetails>
  return result.details
}

export async function runScopedNarrowedChild(): Promise<Record<string, unknown>> {
  const capability = scopedCapability(true)
  const env = await narrowedEnv(childTurn)
  try {
    const details = await spawn(env, capability, "omp-b2-scoped")

    assert.equal(details.kernel_tools?.status, "granted", "a narrowed child must now be granted")
    assert.equal(details.kernel_tools?.scoped, true, "the status record must report the grant was scoped")
    assert.deepEqual(details.kernel_tools?.granted, ["fixture_read_probe", "fixture_write_probe"])
    assert.deepEqual(details.kernel_tools?.scope, { allow: EXPECTED_ALLOW, deny: ["write"] })
    assert.equal(details.status, "completed")

    const record = env.store.load(details.task_id)
    assert.ok(record, "the granted child must have a task record")
    assert.equal(record.final_response, "CHILD_SAW kernel_tool_host_denied")

    // EVERY invoke made on this child's behalf carried the child's own effective policy. The real
    // transport also hands the turn's AbortSignal down, so the option object carries both.
    assert.ok(capability.invokeCalls.length >= 2, "the child must have called both parent tools")
    for (const call of capability.invokeCalls) {
      const options = call.options
      assert.ok(options !== undefined && !(options instanceof AbortSignal), `invoke ${call.request.name} must carry options`)
      assert.deepEqual(options.scope, EXPECTED_SCOPE, `invoke ${call.request.name} must carry the scope`)
      assert.ok(options.signal instanceof AbortSignal, "the turn's abort signal must still ride along")
      assert.equal(call.argCount, 2)
    }
    // The denied nested call never reached the host bridge; the allowed one did.
    assert.deepEqual(capability.hostCalls, ["read"])

    const childSession = env.sessions.at(-1) ?? []
    assert.ok(childSession.includes("fixture_read_probe"), "the child session must expose the granted parent tools")
    assert.ok(!childSession.includes("write"), "the child's own denylist still applies to its own surface")

    return {
      passed: true,
      case: "scoped-narrowed-child",
      capability_marker: capability.capabilities,
      kernel_tools: details.kernel_tools,
      child: { task_id: details.task_id, status: record.status, final_response: record.final_response },
      child_tools: childSession.filter((name) => name.startsWith("fixture_")),
      invoke_options: capability.invokeCalls.map((call) => ({
        name: call.request.name,
        scope: call.options instanceof AbortSignal ? undefined : call.options?.scope,
        signal: call.options instanceof AbortSignal || call.options?.signal === undefined ? "none" : "AbortSignal",
        argCount: call.argCount,
      })),
      host_calls: capability.hostCalls,
      persisted_spawn_spec: record.spawn_spec,
    }
  } finally {
    env.dispose()
  }
}

/** The capability-absent control: the SAME spawn on today's pin is refused exactly as before. */
export async function runUnscopedNarrowedChildRefusal(): Promise<Record<string, unknown>> {
  const capability = scopedCapability(false)
  const env = await narrowedEnv(() => ({ text: "UNEXPECTED_CHILD_TURN" }))
  try {
    const details = await spawn(env, capability, "omp-b2-unscoped")

    assert.equal(details.status, "denied")
    assert.equal(details.kernel_tools?.status, "refused")
    assert.equal(details.kernel_tools?.error?.code, "tools_unavailable")
    assert.equal(details.kernel_tools?.scoped, undefined)
    assert.equal(details.kernel_tools?.granted, undefined)
    assert.deepEqual(env.store.list().records, [], "a refused grant must create no task record")
    assert.equal(env.sessions.length, 0, "a refused grant must open no child session")
    assert.deepEqual(capability.invokeCalls, [], "a refused grant must never reach a parent closure")

    return {
      passed: true,
      case: "unscoped-narrowed-child-refusal",
      capability_marker: capability.capabilities ?? null,
      kernel_tools: details.kernel_tools,
      status: details.status,
      child_sessions_opened: env.sessions.length,
      task_records_created: env.store.list().records.length,
    }
  } finally {
    env.dispose()
  }
}
