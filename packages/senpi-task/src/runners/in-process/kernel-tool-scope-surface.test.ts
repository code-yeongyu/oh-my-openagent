import { describe, expect, test } from "bun:test"

import type { CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"
import { Type } from "typebox"

import { createKernelToolBindings } from "../../kernel-tools/bindings"
import { resolveKernelToolGrant, type KernelToolGrant } from "../../kernel-tools/resolve"
import { InProcessRunner, type ChildSession, type ChildSpec } from "../in-process"
import { RunnerError } from "./runner-error"
import { fakeKernelTools, type FakeKernelToolsCapability } from "./__fixtures__/kernel-tools-fakes"

function tool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `parent tool ${name}`,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

/**
 * The grant is resolved against a DIFFERENT child surface than the runner will see, so a scope that
 * still matches the child's real surface proves the runner recomputed it instead of replaying the
 * tool layer's guess (a category child's real plan is only known at the runner).
 */
async function grantOf(capability: FakeKernelToolsCapability, policy: Partial<ChildSpec> = {}): Promise<KernelToolGrant> {
  capability.define({ name: "lookup", run: (args, host) => (args === "nested" ? host("write") : { seen: args }) })
  const resolved = await resolveKernelToolGrant({
    requestedNames: ["lookup"],
    capability,
    executionMode: "in-process",
    existingToolNames: ["x_search"],
    ...(policy.toolAllowlist === undefined ? {} : { toolAllowlist: policy.toolAllowlist }),
    ...(policy.toolDenylist === undefined ? {} : { toolDenylist: policy.toolDenylist }),
  })
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return resolved.grant
}

function runnerHarness() {
  const bindings = createKernelToolBindings()
  const sessions: CreateAgentSessionOptions[] = []
  const runner = new InProcessRunner({
    kernelToolBindings: bindings,
    sharedParentTools: [tool("grep"), tool("write"), tool("edit"), tool("bash")],
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
  const start = async (spec: Partial<ChildSpec>): Promise<unknown> =>
    await runner.start({
      taskId: "st_00000902",
      cwd: process.cwd(),
      sessionDir: `${process.cwd()}/`,
      depth: 1,
      parentSessionId: "parent",
      rootSessionId: "parent",
      prompt: "work",
      ...spec,
    } as ChildSpec).catch((error: unknown) => error)
  return { bindings, sessions, start }
}

describe("runner floor with a scope-capable parent capability", () => {
  test("#given a child whose denylist narrows the parent #when the session is built #then the child IS granted and the wrapper scopes every invoke to the child's REAL effective surface", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    const grant = await grantOf(capability, { toolDenylist: ["write"] })
    const { bindings, sessions, start } = runnerHarness()

    await start({ kernelTools: grant, toolDenylist: ["write"] })
    const wrapper = sessions[0]?.customTools?.find((entry) => entry.name === "lookup")
    if (wrapper === undefined) throw new Error("the narrowed child must carry the wrapper")
    await wrapper.execute("call-1", { q: 1 } as never, undefined, undefined, {} as never)

    expect(bindings.get("st_00000902")).toBe(grant)
    expect(capability.invokeCalls[0]?.options).toEqual({
      scope: { tools: { allow: ["read", "bash", "edit", "grep"], deny: ["write"] } },
    })
  })

  test("#given an allowlisted child #when the wrapper invokes #then the scope is the allowlist intersection, and the denied nested call lands on the CHILD's envelope", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    const grant = await grantOf(capability, { toolAllowlist: ["read", "grep"] })
    const { sessions, start } = runnerHarness()

    await start({ kernelTools: grant, toolAllowlist: ["read", "grep"] })
    const wrapper = sessions[0]?.customTools?.find((entry) => entry.name === "lookup")
    if (wrapper === undefined) throw new Error("the narrowed child must carry the wrapper")
    const result = await wrapper.execute("call-2", "nested" as never, undefined, undefined, {} as never)

    expect(capability.invokeCalls[0]?.options).toEqual({ scope: { tools: { allow: ["read", "grep"] } } })
    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({ kernel_tool: "lookup", error: { code: "kernel_tool_host_denied" } })
    expect(capability.hostCalls).toEqual([])
  })

  test("#given a curated child #when a scope-capable grant is attached anyway #then the runner still refuses typed and binds nothing", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    const grant = await grantOf(capability)
    const { bindings, sessions, start } = runnerHarness()

    const failure = await start({ kernelTools: grant, agentType: "explore" })

    expect(RunnerError.is(failure)).toBe(true)
    if (!RunnerError.is(failure)) throw new Error("unreachable")
    expect(failure.failure.kind).toBe("tools_unavailable")
    expect(sessions).toEqual([])
    expect(bindings.size).toBe(0)
  })
})
