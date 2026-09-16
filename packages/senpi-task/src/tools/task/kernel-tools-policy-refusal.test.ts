import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { createTaskManager } from "../../manager/manager"
import { createInProcessManagedRunner } from "../../manager/runner"
import { InProcessRunner, type ChildSession } from "../../runners/in-process"
import { fakeKernelTools } from "../../runners/in-process/__fixtures__/kernel-tools-fakes"
import { createTaskRecordStore } from "../../store"
import { buildTaskExecute } from "./execute"
import { makeDeps } from "./__fixtures__/task-tool-fakes"
import type { TaskToolContext, TaskToolDetails } from "./types"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

// The child surface a real parent shares: the engine's write-capable builtins are added by the rule.
const CHILD_TOOLS = ["read", "grep", "x_search"]

// The two supported ways an omo.json agent takes `write` away. The first resolves to an EMPTY
// allowlist plus a denylist (the shape that slipped through the old length-based guard), the second
// to a denylist only.
const NO_WRITE_RULE: AgentDefinition = { name: "probe-no-write", tools: [{ pattern: "write", allow: false }] }
const DENY_ONLY: AgentDefinition = { name: "probe-deny-only", disallowedTools: ["write"] }

function harness() {
  const root = mkdtempSync(join(tmpdir(), "omp-o6-policy-"))
  roots.push(root)
  const store = createTaskRecordStore({ project_dir: root })
  const sessions: CreateAgentSessionOptions[] = []
  const inProcess = new InProcessRunner({
    sharedParentTools: [],
    createSession: async (options) => {
      sessions.push(options)
      return {
        sessionId: "child-session",
        prompt: async () => undefined,
        steer: async () => undefined,
        followUp: async () => undefined,
        abort: async () => undefined,
        subscribe: () => () => undefined,
        getLastAssistantText: () => undefined,
        dispose: () => undefined,
      } satisfies ChildSession
    },
  })
  const runner = createInProcessManagedRunner(inProcess)
  const manager = createTaskManager({
    store,
    config: OmoTaskSettingsSchema.parse({}),
    cwd: root,
    runners: { "in-process": runner, process: runner },
    // Mirrors omo's planner for these agents: the persona's literal rules ride the plan.
    planner: (spec) => ({
      kind: "resolved",
      plan: {
        model: "fixture/fixture",
        ...(spec.subagent_type === NO_WRITE_RULE.name ? { agentType: spec.subagent_type, toolAllowlist: [], toolDenylist: ["write"] } : {}),
        ...(spec.subagent_type === DENY_ONLY.name ? { agentType: spec.subagent_type, toolDenylist: ["write"] } : {}),
      },
    }),
  })
  const capability = fakeKernelTools()
  capability.define({ name: "fixture_write" })
  const deps = makeDeps(manager, {
    agents: { [NO_WRITE_RULE.name]: NO_WRITE_RULE, [DENY_ONLY.name]: DENY_ONLY },
    resolveChildToolNames: () => CHILD_TOOLS,
  })
  const context: TaskToolContext = { cwd: root, sessionManager: { getSessionId: () => "parent" }, kernelTools: capability }
  const spawn = async (subagentType: string): Promise<TaskToolDetails> =>
    (await buildTaskExecute(deps)("call-1", {
      prompt: "use the parent tool",
      subagent_type: subagentType,
      run_in_background: true,
      tools: ["fixture_write"],
    } as never, undefined, undefined, context)).details
  return { spawn, store, sessions, capability }
}

/**
 * The verifier's reproduction: an agent that takes `write` away still received the grant, and the
 * closure's nested `tool.write(...)` then ran with PARENT permissions. The refusal now happens at
 * the tool layer, so there is no session, no record and no closure invocation at all.
 */
describe("kernel-tool grants for children whose own policy removes a write tool", () => {
  test("#given an agent whose rules resolve to an EMPTY allowlist #when it requests a parent tool #then the grant is refused with a typed code and nothing is created", async () => {
    const { spawn, store, sessions, capability } = harness()

    const details = await spawn(NO_WRITE_RULE.name)

    expect(details.status).toBe("denied")
    expect(details.kernel_tools?.status).toBe("refused")
    expect(details.kernel_tools?.error?.code).toBe("tools_unavailable")
    expect(details.kernel_tools?.granted).toBeUndefined()
    expect(sessions).toEqual([])
    expect(store.list().records).toEqual([])
    expect(capability.invocations).toEqual([])
  })

  test("#given a deny-only agent #when it requests a parent tool #then the denylist alone refuses the grant", async () => {
    const { spawn, store, sessions } = harness()

    const details = await spawn(DENY_ONLY.name)

    expect(details.kernel_tools?.status).toBe("refused")
    expect(details.kernel_tools?.error?.code).toBe("tools_unavailable")
    expect(sessions).toEqual([])
    expect(store.list().records).toEqual([])
  })
})
