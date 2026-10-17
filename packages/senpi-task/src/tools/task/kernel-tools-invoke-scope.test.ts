import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { CreateAgentSessionOptions } from "@code-yeongyu/senpi"
import { OmoTaskSettingsSchema } from "@oh-my-opencode/omo-config-core"

import type { AgentDefinition } from "../../agents"
import { createKernelToolBindings } from "../../kernel-tools/bindings"
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

// The parent's view of what a child carries. The runner recomputes the same set from the real
// child surface (no shared parent tools here), so both layers agree on the effective allow list.
const CHILD_TOOLS = ["read", "grep"]

// The two supported ways an omo.json agent takes `write` away: an EMPTY allowlist plus a denylist,
// and a denylist alone. Both were refused before the producer could scope the nested host calls.
const NO_WRITE_RULE: AgentDefinition = { name: "probe-no-write", tools: [{ pattern: "write", allow: false }] }
const DENY_ONLY: AgentDefinition = { name: "probe-deny-only", disallowedTools: ["write"] }
const CURATED: AgentDefinition = { name: "explore" }

function harness() {
  const root = mkdtempSync(join(tmpdir(), "omp-b2-scope-"))
  roots.push(root)
  const store = createTaskRecordStore({ project_dir: root })
  const sessions: CreateAgentSessionOptions[] = []
  const bindings = createKernelToolBindings()
  const inProcess = new InProcessRunner({
    sharedParentTools: [],
    kernelToolBindings: bindings,
    createSession: async (options) => {
      sessions.push(options)
      return {
        sessionId: "child-session",
        prompt: async () => undefined,
        steer: async () => "handled",
        followUp: async () => "handled",
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
    kernelToolBindings: bindings,
    runners: { "in-process": runner, process: runner },
    planner: (spec) => ({
      kind: "resolved",
      plan: {
        model: "fixture/fixture",
        ...(spec.subagent_type === NO_WRITE_RULE.name ? { agentType: spec.subagent_type, toolAllowlist: [], toolDenylist: ["write"] } : {}),
        ...(spec.subagent_type === DENY_ONLY.name ? { agentType: spec.subagent_type, toolDenylist: ["write"] } : {}),
      },
    }),
  })
  const capability = fakeKernelTools({ invokeScope: true })
  capability.define({ name: "fixture_write", run: (args, host) => (args === "nested" ? host("write") : { seen: args }) })
  const deps = makeDeps(manager, {
    agents: { [NO_WRITE_RULE.name]: NO_WRITE_RULE, [DENY_ONLY.name]: DENY_ONLY, [CURATED.name]: CURATED },
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
 * The M3 ideal the O6 work documented: with the producer's per-call scope available, a child whose
 * own policy is narrower than the parent's is GRANTED, and the closure's nested host calls run
 * child-permissioned instead of parent-permissioned.
 */
describe("a narrowed child asking for parent kernel tools from a scope-capable parent", () => {
  test("#given an agent whose rules resolve to an EMPTY allowlist #when it requests a parent tool #then the grant lands, the status reports the scope and the child session exists", async () => {
    const { spawn, store, sessions } = harness()

    const details = await spawn(NO_WRITE_RULE.name)

    expect(details.kernel_tools?.status).toBe("granted")
    expect(details.kernel_tools?.granted).toEqual(["fixture_write"])
    expect(details.kernel_tools?.error).toBeUndefined()
    expect(details.kernel_tools?.scoped).toBe(true)
    expect(details.kernel_tools?.scope).toEqual({ allow: [], deny: ["write"] })
    expect(sessions.length).toBe(1)
    expect(sessions[0]?.customTools?.map((entry) => entry.name)).toContain("fixture_write")
    expect(store.list().records.length).toBe(1)
  })

  test("#given a deny-only agent #when its child calls the granted tool #then every invoke carries the child's effective allow list and its denylist", async () => {
    const { spawn, sessions, capability } = harness()

    const details = await spawn(DENY_ONLY.name)
    const wrapper = sessions[0]?.customTools?.find((entry) => entry.name === "fixture_write")
    if (wrapper === undefined) throw new Error("the granted child must carry the wrapper")
    await wrapper.execute("call-2", { q: 1 } as never, undefined, undefined, {} as never)

    expect(details.kernel_tools?.status).toBe("granted")
    expect(details.kernel_tools?.scoped).toBe(true)
    expect(details.kernel_tools?.scope).toEqual({ allow: ["read", "bash", "edit", "grep"], deny: ["write"] })
    expect(capability.invokeCalls[0]?.options).toEqual({
      scope: { tools: { allow: ["read", "bash", "edit", "grep"], deny: ["write"] } },
    })
  })

  test("#given a curated read-only agent #when it requests a parent tool #then the refusal is unchanged and nothing is created", async () => {
    const { spawn, store, sessions, capability } = harness()

    const details = await spawn(CURATED.name)

    expect(details.status).toBe("denied")
    expect(details.kernel_tools?.status).toBe("refused")
    expect(details.kernel_tools?.error?.code).toBe("curated_policy_denied")
    expect(details.kernel_tools?.scoped).toBeUndefined()
    expect(sessions).toEqual([])
    expect(store.list().records).toEqual([])
    expect(capability.invokeCalls).toEqual([])
  })
})
