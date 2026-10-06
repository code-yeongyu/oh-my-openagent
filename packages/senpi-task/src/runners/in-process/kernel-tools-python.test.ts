import { describe, expect, test } from "bun:test"

import { isKernelToolDescriptor } from "../../kernel-tools/contract"
import { resolveKernelToolGrant } from "../../kernel-tools/resolve"
import { createKernelToolWrappers } from "../../kernel-tools/wrapper"
import { fakeKernelTools } from "./__fixtures__/kernel-tools-fakes"

function grantRequest(capability: ReturnType<typeof fakeKernelTools>, requestedNames: readonly string[]) {
  return { requestedNames, capability, executionMode: "in-process" as const }
}

describe("Python kernel tools", () => {
  test("#given a parent Python @tool #when a child requests it #then the grant carries its descriptor", async () => {
    const capability = fakeKernelTools()
    const descriptor = capability.define({ name: "add", language: "py" })

    const resolved = await resolveKernelToolGrant(grantRequest(capability, ["add"]))

    expect(resolved.kind).toBe("granted")
    if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${JSON.stringify(resolved)}`)
    expect(resolved.grant.descriptors).toEqual([descriptor])
  })

  test("#given a granted Python tool #when the child calls it #then the call goes back to the defining kernel and returns its result", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "add", language: "py", run: () => ({ sum: 3 }) })
    const resolved = await resolveKernelToolGrant(grantRequest(capability, ["add"]))
    if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${JSON.stringify(resolved)}`)
    const [wrapper] = createKernelToolWrappers(resolved.grant)
    if (wrapper === undefined) throw new Error("no wrapper for the granted Python tool")

    const result = await wrapper.execute("call-1", { a: 1, b: 2 } as never, undefined, undefined, {} as never)

    expect(JSON.stringify(result)).toContain("3")
    expect(capability.invocations.map((call) => call.name)).toEqual(["add"])
  })

  test("#given JavaScript and Python tools requested together #when resolved #then both are granted", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    capability.define({ name: "add", language: "py" })

    const resolved = await resolveKernelToolGrant(grantRequest(capability, ["lookup", "add"]))

    expect(resolved.kind).toBe("granted")
    if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${JSON.stringify(resolved)}`)
    expect(resolved.grant.descriptors.map((descriptor) => descriptor.language)).toEqual(["js", "py"])
  })

  test("#given a descriptor from a kernel that does not define tools #when validated #then it is refused", () => {
    const base = { name: "add", description: "d", input_schema: {}, kernel_generation: 1, definition_revision: 1 }

    expect(isKernelToolDescriptor({ ...base, language: "py" })).toBe(true)
    expect(isKernelToolDescriptor({ ...base, language: "rb" })).toBe(false)
    expect(isKernelToolDescriptor({ ...base, language: "jl" })).toBe(false)
  })

  test("#given an undefined name #when resolved #then the coaching names both ways to define a tool", async () => {
    const resolved = await resolveKernelToolGrant(grantRequest(fakeKernelTools(), ["missing"]))

    expect(resolved).toMatchObject({ kind: "denied", code: "kernel_tool_missing" })
    if (resolved.kind !== "denied") throw new Error("unreachable")
    expect(resolved.message).toContain("tool(function missing")
    expect(resolved.message).toContain("@tool def missing")
  })
})
