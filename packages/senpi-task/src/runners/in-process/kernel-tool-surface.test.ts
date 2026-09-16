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

async function grantOf(capability: FakeKernelToolsCapability): Promise<KernelToolGrant> {
  capability.define({ name: "lookup", run: (args) => ({ seen: args }) })
  const resolved = await resolveKernelToolGrant({ requestedNames: ["lookup"], capability, executionMode: "in-process" })
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return resolved.grant
}

describe("in-process runner kernel-tool grant", () => {
  function runnerHarness() {
    const bindings = createKernelToolBindings()
    const sessions: CreateAgentSessionOptions[] = []
    const runner = new InProcessRunner({
      kernelToolBindings: bindings,
      sharedParentTools: [tool("grep"), tool("write"), tool("edit"), tool("bash")],
      createSession: async (options) => {
        sessions.push(options)
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
    const start = async (spec: Partial<ChildSpec>): Promise<unknown> =>
      await runner.start({
        taskId: "st_00000901",
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

  test("#given a transient grant on the child spec #when the child session is built #then the wrapper is a custom tool and the binding lands after the session exists", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const { bindings, sessions, start } = runnerHarness()

    await start({ kernelTools: grant, toolAllowlist: undefined })

    expect(sessions[0]?.customTools?.map((entry) => entry.name)).toContain("lookup")
    expect(bindings.get("st_00000901")).toBe(grant)
  })

  test("#given a child whose resolved policy removes a write-capable parent tool #when the session is built #then the runner refuses typed, opens no session and leaves no binding", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const { bindings, sessions, start } = runnerHarness()

    const denied = await start({ kernelTools: grant, toolDenylist: ["write"] })
    const allowlisted = await start({ kernelTools: grant, toolAllowlist: ["grep"] })

    for (const failure of [denied, allowlisted]) {
      expect(RunnerError.is(failure)).toBe(true)
      if (!RunnerError.is(failure)) throw new Error("unreachable")
      expect(failure.failure.kind).toBe("tools_unavailable")
    }
    expect(sessions).toEqual([])
    expect(bindings.keys()).toEqual([])
    expect(capability.invocations).toEqual([])
  })

  test("#given a curated child #when a grant is attached anyway #then the runner refuses typed and binds nothing", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const { bindings, sessions, start } = runnerHarness()

    const failure = await start({ kernelTools: grant, agentType: "explore" })

    expect(RunnerError.is(failure)).toBe(true)
    if (!RunnerError.is(failure)) throw new Error("unreachable")
    expect(failure.failure.kind).toBe("tools_unavailable")
    expect(sessions).toEqual([])
    expect(bindings.size).toBe(0)
  })

  test("#given a STARTED child #when its binding is released mid-life #then the live wrapper fails closed instead of reaching the kernel", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const { bindings, sessions, start } = runnerHarness()
    await start({ kernelTools: grant })
    const wrapper = sessions[0]?.customTools?.find((entry) => entry.name === "lookup")
    if (wrapper === undefined) throw new Error("the child must carry the wrapper")

    bindings.release("st_00000901")
    const result = await wrapper.execute("call-1", {} as never, undefined, undefined, {} as never)

    expect(result.isError).toBe(true)
    expect(capability.invocations).toEqual([])
  })

  test("#given a start that fails after an earlier grant #when it throws #then the child's stale binding is released", async () => {
    const capability = fakeKernelTools()
    const grant = await grantOf(capability)
    const { bindings, start } = runnerHarness()
    await start({ kernelTools: grant })
    expect(bindings.get("st_00000901")).toBe(grant)

    const failure = await start({ kernelTools: grant, sessionDir: "" })

    expect(RunnerError.is(failure)).toBe(true)
    expect(bindings.size).toBe(0)
  })
})
