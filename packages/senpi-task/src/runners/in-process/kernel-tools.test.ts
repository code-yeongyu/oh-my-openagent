import { describe, expect, test } from "bun:test"

import type { AgentToolResult, CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"

import { resolveKernelToolGrant, type KernelToolGrant } from "../../kernel-tools/resolve"
import { createKernelToolWrappers } from "../../kernel-tools/wrapper"
import { isReservedKernelToolName, kernelToolKey, normalizeKernelToolName } from "../../kernel-tools/names"
import { InProcessRunner, type ChildSession, type ChildSpec } from "../in-process"
import { RunnerError } from "./runner-error"
import { fakeKernelTools } from "./__fixtures__/kernel-tools-fakes"

function tool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `parent tool ${name}`,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

function grantRequest(overrides: Partial<Parameters<typeof resolveKernelToolGrant>[0]> = {}) {
  const capability = overrides.capability === undefined ? fakeKernelTools() : overrides.capability
  return { requestedNames: ["lookup"], capability, executionMode: "in-process" as const, ...overrides }
}

async function detailsOf(wrapper: ToolDefinition, args: Record<string, unknown> = {}): Promise<AgentToolResult<unknown>> {
  return (await wrapper.execute("call-1", args as never, undefined, undefined, {} as never)) as AgentToolResult<unknown>
}

function errorCode(result: AgentToolResult<unknown>): string | undefined {
  const details = result.details
  if (typeof details !== "object" || details === null || !("error" in details)) return undefined
  const error = (details as { error?: { code?: string } }).error
  return error?.code
}

async function grantOf(capability = fakeKernelTools(), names: readonly string[] = ["lookup"]): Promise<KernelToolGrant> {
  capability.define({ name: "lookup", run: (args) => ({ seen: args }) })
  const resolved = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: names }))
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return resolved.grant
}

describe("kernel tool name normalization", () => {
  test("#given kernel tool names #when normalized #then MCP grammar and the dash/underscore matcher key apply", () => {
    expect(normalizeKernelToolName("look up!")).toBe("look_up_")
    expect(normalizeKernelToolName("a".repeat(70))).toHaveLength(64)
    expect(kernelToolKey("look-up")).toBe(kernelToolKey("look_up"))
  })

  test("#given bridge and task-family names #when checked #then they are reserved", () => {
    expect(isReservedKernelToolName("__agent__")).toBe(true)
    expect(isReservedKernelToolName("task")).toBe(true)
    expect(isReservedKernelToolName("task_send")).toBe(true)
    expect(isReservedKernelToolName("team_create")).toBe(true)
    expect(isReservedKernelToolName("workpool")).toBe(true)
    expect(isReservedKernelToolName("lookup")).toBe(false)
  })
})

describe("kernel tool grant resolution", () => {
  test("#given a live JS parent capability #when an in-process non-curated child requests names #then descriptors are resolved by describe", async () => {
    const capability = fakeKernelTools()
    const descriptor = capability.define({ name: "lookup" })

    const resolved = await resolveKernelToolGrant(grantRequest({ capability }))

    expect(resolved.kind).toBe("granted")
    if (resolved.kind !== "granted") throw new Error("unreachable")
    expect(resolved.grant.descriptors).toEqual([descriptor])
    expect(capability.describeCalls).toEqual([["lookup"]])
  })

  test("#given no requested names #when resolved #then nothing is granted and describe is never called", async () => {
    const capability = fakeKernelTools()

    const resolved = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: [] }))

    expect(resolved.kind).toBe("none")
    expect(capability.describeCalls).toEqual([])
  })

  test("#given a curated read-only agent #when it requests any parent tool #then the grant is denied as curated_policy_denied", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    const resolved = await resolveKernelToolGrant(grantRequest({ capability, agentType: "explore" }))

    expect(resolved).toMatchObject({ kind: "denied", code: "curated_policy_denied" })
    expect(capability.invocations).toEqual([])
  })

  test("#given process, team, or a non-JS parent #when names are requested #then the grant is tools_unavailable", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    const process = await resolveKernelToolGrant(grantRequest({ capability, executionMode: "process" }))
    const team = await resolveKernelToolGrant(grantRequest({ capability, teamRole: "member" }))
    const nonJs = await resolveKernelToolGrant(grantRequest({ capability: undefined }))

    for (const resolved of [process, team, nonJs]) {
      expect(resolved).toMatchObject({ kind: "denied", code: "tools_unavailable" })
    }
  })

  test("#given duplicate or normalization-colliding names #when resolved #then the grant is tool_name_collision", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    const duplicate = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: ["lookup", "lookup"] }))
    const normalized = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: ["look_up", "look-up"] }))

    expect(duplicate).toMatchObject({ kind: "denied", code: "tool_name_collision" })
    expect(normalized).toMatchObject({ kind: "denied", code: "tool_name_collision" })
  })

  test("#given a name that collides with an existing child tool #when resolved #then the grant is tool_name_collision", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "grep" })

    const resolved = await resolveKernelToolGrant(
      grantRequest({ capability, requestedNames: ["grep"], existingToolNames: ["grep", "read"] }),
    )

    expect(resolved).toMatchObject({ kind: "denied", code: "tool_name_collision" })
  })

  test("#given a reserved alias #when resolved #then the grant is reserved_tool_name", async () => {
    const capability = fakeKernelTools()

    const resolved = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: ["task_send"] }))

    expect(resolved).toMatchObject({ kind: "denied", code: "reserved_tool_name" })
    expect(capability.describeCalls).toEqual([])
  })

  test("#given an undefined name #when resolved #then the denial is kernel_tool_missing and coaches definition first", async () => {
    const capability = fakeKernelTools()

    const resolved = await resolveKernelToolGrant(grantRequest({ capability, requestedNames: ["missing"] }))

    expect(resolved).toMatchObject({ kind: "denied", code: "kernel_tool_missing" })
    if (resolved.kind !== "denied") throw new Error("unreachable")
    expect(resolved.message).toContain("tool(")
  })

  test("#given a child whose policy narrows the parent surface #when resolved #then the grant fails closed instead of bypassing the child policy", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })

    const denied = await resolveKernelToolGrant(grantRequest({ capability, toolDenylist: ["write"] }))
    const allowlisted = await resolveKernelToolGrant(grantRequest({ capability, toolAllowlist: ["read"] }))

    expect(denied).toMatchObject({ kind: "denied", code: "tools_unavailable" })
    expect(allowlisted).toMatchObject({ kind: "denied", code: "tools_unavailable" })
  })

  test("#given a dead parent kernel #when resolved #then the denial is typed and no child tool is produced", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    capability.kill()

    const resolved = await resolveKernelToolGrant(grantRequest({ capability }))

    expect(resolved).toMatchObject({ kind: "denied", code: "tools_unavailable" })
  })
})

describe("kernel tool child wrappers", () => {
  test("#given a granted descriptor #when the child calls the wrapper #then the live parent capability is called BY NAME with the descriptor tuple", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const wrapper = createKernelToolWrappers(grant)[0]
    expect(wrapper).toBeDefined()
    if (wrapper === undefined) throw new Error("unreachable")

    const result = await detailsOf(wrapper, { value: "x" })

    expect(wrapper.name).toBe("lookup")
    expect(capability.invocations).toHaveLength(1)
    expect(capability.invocations[0]).toMatchObject({
      name: "lookup",
      kernel_generation: capability.descriptor("lookup").kernel_generation,
      definition_revision: capability.descriptor("lookup").definition_revision,
      args: { value: "x" },
      call_id: "call-1",
    })
    expect(result.content[0]).toMatchObject({ type: "text" })
    expect(errorCode(result)).toBeUndefined()
  })

  test("#given a parent kernel that reset after the grant #when the child calls the wrapper #then a typed error lands on the CHILD tool-result channel", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const wrapper = createKernelToolWrappers(grant)[0]
    if (wrapper === undefined) throw new Error("unreachable")
    capability.reset()

    const result = await detailsOf(wrapper)

    expect(result.isError).toBe(true)
    expect(errorCode(result)).toBe("kernel_tool_stale")
  })

  test("#given a parent closure that throws #when the child calls the wrapper #then the child receives kernel_tool_failed rather than an exception", async () => {
    const capability = fakeKernelTools()
    capability.define({
      name: "lookup",
      run: () => {
        throw new Error("closure exploded")
      },
    })
    const resolved = await resolveKernelToolGrant(grantRequest({ capability }))
    if (resolved.kind !== "granted") throw new Error("unreachable")
    const wrapper = createKernelToolWrappers(resolved.grant)[0]
    if (wrapper === undefined) throw new Error("unreachable")

    const result = await detailsOf(wrapper)

    expect(result.isError).toBe(true)
    expect(errorCode(result)).toBe("kernel_tool_failed")
  })
})

describe("in-process runner kernel-tool grant", () => {
  async function startWith(spec: Partial<ChildSpec>): Promise<CreateAgentSessionOptions> {
    let captured: CreateAgentSessionOptions | undefined
    const runner = new InProcessRunner({
      sharedParentTools: [tool("grep")],
      createSession: async (options) => {
        captured = options
        const session: ChildSession = {
          sessionId: "child-session",
          prompt: async () => undefined,
          steer: async () => undefined,
          followUp: async () => undefined,
          abort: async () => undefined,
          subscribe: () => () => undefined,
          getLastAssistantText: () => undefined,
          dispose: () => undefined,
        }
        return session
      },
    })
    await runner.start({
      taskId: "st_00000901",
      cwd: process.cwd(),
      sessionDir: `${process.cwd()}/`,
      depth: 1,
      parentSessionId: "parent",
      rootSessionId: "parent",
      prompt: "work",
      ...spec,
    } as ChildSpec)
    if (captured === undefined) throw new Error("session options were not captured")
    return captured
  }

  test("#given a transient grant on the child spec #when the child session is built #then the wrapper is a custom tool and is allowed by name", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)

    const options = await startWith({ kernelTools: grant, toolAllowlist: undefined })

    expect(options.customTools?.map((entry) => entry.name)).toContain("lookup")
  })

  test("#given a child whose resolved policy narrows the parent surface #when the session is built #then the runner refuses typed and creates no session", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)

    const denied = await startWith({ kernelTools: grant, toolDenylist: ["write"] }).catch((error: unknown) => error)
    const allowlisted = await startWith({ kernelTools: grant, toolAllowlist: ["read"] }).catch((error: unknown) => error)

    for (const failure of [denied, allowlisted]) {
      expect(RunnerError.is(failure)).toBe(true)
      if (!RunnerError.is(failure)) throw new Error("unreachable")
      expect(failure.failure.kind).toBe("tools_unavailable")
    }
    expect(capability.invocations).toEqual([])
  })

  test("#given a curated child #when a grant is attached anyway #then the runner refuses typed instead of granting", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)

    const failure = await startWith({ kernelTools: grant, agentType: "explore" }).catch((error: unknown) => error)

    expect(RunnerError.is(failure)).toBe(true)
    if (!RunnerError.is(failure)) throw new Error("unreachable")
    expect(failure.failure.kind).toBe("tools_unavailable")
  })
})
