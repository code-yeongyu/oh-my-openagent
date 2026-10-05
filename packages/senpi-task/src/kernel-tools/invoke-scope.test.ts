import { describe, expect, test } from "bun:test"

import { fakeKernelTools } from "../runners/in-process/__fixtures__/kernel-tools-fakes"
import { supportsInvokeScope, type KernelToolsCapability } from "./contract"
import { childInvokeScope } from "./nested-host-scope"
import { resolveKernelToolGrant, type KernelToolGrant } from "./resolve"
import { createKernelToolWrappers } from "./wrapper"

// The names a child of this parent already carries before its own allow/deny is applied. The
// session builtins (read, bash, edit, write, grep) are unioned by the shared rule.
const CHILD_TOOLS = ["read", "grep", "x_search"]
const EFFECTIVE_WITHOUT_WRITE = ["read", "bash", "edit", "grep", "x_search"]

async function grant(
  capability: KernelToolsCapability,
  policy: { readonly toolAllowlist?: readonly string[]; readonly toolDenylist?: readonly string[]; readonly agentType?: string } = {},
): Promise<ReturnType<typeof resolveKernelToolGrant>> {
  return resolveKernelToolGrant({
    requestedNames: ["fixture_write"],
    capability,
    executionMode: "in-process",
    existingToolNames: CHILD_TOOLS,
    ...policy,
  })
}

function granted(resolution: Awaited<ReturnType<typeof resolveKernelToolGrant>>): KernelToolGrant {
  if (resolution.kind !== "granted") {
    throw new Error(`expected a grant, got ${resolution.kind}: ${"message" in resolution ? resolution.message : ""}`)
  }
  return resolution.grant
}

describe("invoke-scope capability detection", () => {
  test("#given a capability without the marker #when detected #then the consumer must not send a scope", () => {
    expect(supportsInvokeScope(fakeKernelTools())).toBe(false)
    expect(supportsInvokeScope(undefined)).toBe(false)
  })

  test("#given the producer's capabilities marker #when detected #then only the literal true opts in", () => {
    expect(supportsInvokeScope(fakeKernelTools({ invokeScope: true }))).toBe(true)
    const shapes = [{ invokeScope: "yes" }, { invokeScope: 1 }, {}, null, "invokeScope"]
    for (const capabilities of shapes) {
      const capability = { ...fakeKernelTools(), capabilities } as unknown as KernelToolsCapability
      expect(supportsInvokeScope(capability)).toBe(false)
    }
  })
})

describe("child invoke scope shape", () => {
  test("#given a child policy #when the scope is built #then allow is the effective set and a denylist rides along", () => {
    expect(childInvokeScope({ childToolNames: CHILD_TOOLS, toolDenylist: ["write"] })).toEqual({
      tools: { allow: EFFECTIVE_WITHOUT_WRITE, deny: ["write"] },
    })
    expect(childInvokeScope({ childToolNames: CHILD_TOOLS })).toEqual({
      tools: { allow: ["read", "bash", "edit", "write", "grep", "x_search"] },
    })
    // `tools: { write: false }` resolves to an EMPTY allowlist plus a denylist: the child may cause
    // nothing on the host, so the closure's nested calls may not either.
    expect(childInvokeScope({ childToolNames: CHILD_TOOLS, toolAllowlist: [], toolDenylist: ["write"] })).toEqual({
      tools: { allow: [], deny: ["write"] },
    })
  })
})

describe("a capability that advertises invokeScope", () => {
  test("#given a child whose denylist narrows the parent #when the grant is resolved #then it is GRANTED carrying the child's effective policy as the scope", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    capability.define({ name: "fixture_write" })

    const resolved = await grant(capability, { toolDenylist: ["write"] })

    expect(resolved.kind).toBe("granted")
    expect(granted(resolved).scope).toEqual({ tools: { allow: EFFECTIVE_WITHOUT_WRITE, deny: ["write"] } })
  })

  test("#given an EMPTY allowlist child (tools:{write:false}) #when the grant is resolved #then it is GRANTED with an empty allow scope", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    capability.define({ name: "fixture_write" })

    const resolved = await grant(capability, { toolAllowlist: [], toolDenylist: ["write"] })

    expect(resolved.kind).toBe("granted")
    expect(granted(resolved).scope).toEqual({ tools: { allow: [], deny: ["write"] } })
  })

  test("#given a granted scope #when the child calls the wrapper #then EVERY invoke carries exactly that scope beside the signal", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    capability.define({ name: "fixture_write", run: (args) => ({ echoed: args }) })
    const wrappers = createKernelToolWrappers(granted(await grant(capability, { toolDenylist: ["write"] })))
    const wrapper = wrappers[0]
    if (wrapper === undefined) throw new Error("the grant must produce a wrapper")
    const signal = new AbortController().signal

    await wrapper.execute("call-1", { value: "a" } as never, signal, undefined, {} as never)
    await wrapper.execute("call-2", { value: "b" } as never, undefined, undefined, {} as never)

    expect(capability.invokeCalls).toEqual([
      {
        request: {
          name: "fixture_write",
          kernel_generation: 1,
          definition_revision: 1,
          args: { value: "a" },
          call_id: "call-1",
        },
        options: { signal, scope: { tools: { allow: EFFECTIVE_WITHOUT_WRITE, deny: ["write"] } } },
        argCount: 2,
      },
      {
        request: {
          name: "fixture_write",
          kernel_generation: 1,
          definition_revision: 1,
          args: { value: "b" },
          call_id: "call-2",
        },
        options: { scope: { tools: { allow: EFFECTIVE_WITHOUT_WRITE, deny: ["write"] } } },
        argCount: 2,
      },
    ])
  })

  test("#given a curated read-only agent #when it asks for a parent tool #then the grant is STILL refused regardless of the capability", async () => {
    const capability = fakeKernelTools({ invokeScope: true })
    capability.define({ name: "fixture_write" })

    const resolved = await grant(capability, { agentType: "explore", toolDenylist: ["write"] })

    expect(resolved).toMatchObject({ kind: "denied", code: "curated_policy_denied" })
    expect(capability.invokeCalls).toEqual([])
  })
})

describe("a nested host call refused inside the scoped invocation", () => {
  async function callWithNested(tool: string): Promise<{ readonly isError?: boolean; readonly details: unknown; readonly text: string }> {
    const capability = fakeKernelTools({ invokeScope: true })
    capability.define({ name: "fixture_write", run: (_args, host) => host(tool) })
    const wrappers = createKernelToolWrappers(granted(await grant(capability, { toolDenylist: ["write"] })))
    const wrapper = wrappers[0]
    if (wrapper === undefined) throw new Error("the grant must produce a wrapper")
    const result = await wrapper.execute("call-9", {} as never, undefined, undefined, {} as never)
    const first = result.content[0]
    return {
      ...(result.isError === undefined ? {} : { isError: result.isError }),
      details: result.details,
      text: first !== undefined && first.type === "text" ? first.text : "",
    }
  }

  test("#given the closure reaches a tool the child denied #when the child calls it #then kernel_tool_host_denied lands on the CHILD's envelope, not as a thrown failure", async () => {
    const result = await callWithNested("write")

    expect(result.isError).toBe(true)
    expect(result.details).toMatchObject({
      kernel_tool: "fixture_write",
      error: { code: "kernel_tool_host_denied" },
    })
    expect(JSON.parse(result.text)).toMatchObject({
      kernel_tool: "fixture_write",
      error: { code: "kernel_tool_host_denied" },
    })
  })

  test("#given the closure reaches a tool the child keeps #when the child calls it #then the nested call runs and the value comes back", async () => {
    const result = await callWithNested("read")

    expect(result.isError).toBeUndefined()
    expect(JSON.parse(result.text)).toEqual({ kernel_tool: "fixture_write", value: "host:read" })
  })
})

describe("a capability WITHOUT the marker keeps today's behavior byte for byte", () => {
  test("#given a narrowed child #when the grant is resolved #then it is refused as tools_unavailable naming the escalation", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "fixture_write" })

    const denied = await grant(capability, { toolDenylist: ["write"] })
    const allowlisted = await grant(capability, { toolAllowlist: [], toolDenylist: ["write"] })

    for (const resolution of [denied, allowlisted]) {
      expect(resolution).toMatchObject({ kind: "denied", code: "tools_unavailable" })
      if (resolution.kind !== "denied") throw new Error("unreachable")
      expect(resolution.message).toContain("write")
    }
    expect(capability.invokeCalls).toEqual([])
  })

  test("#given an unnarrowed child #when the wrapper invokes #then the second argument is the bare signal, with no scope object", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "fixture_write" })
    const resolution = await grant(capability)
    expect(granted(resolution).scope).toBeUndefined()
    const wrappers = createKernelToolWrappers(granted(resolution))
    const wrapper = wrappers[0]
    if (wrapper === undefined) throw new Error("the grant must produce a wrapper")
    const signal = new AbortController().signal

    await wrapper.execute("call-1", { value: "a" } as never, signal, undefined, {} as never)
    await wrapper.execute("call-2", { value: "b" } as never, undefined, undefined, {} as never)

    expect(capability.invokeCalls.map((call) => ({ options: call.options, argCount: call.argCount }))).toEqual([
      { options: signal, argCount: 2 },
      { options: undefined, argCount: 2 },
    ])
  })
})
