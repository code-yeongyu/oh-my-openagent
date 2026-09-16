import { describe, expect, test } from "bun:test"
import { Type } from "typebox"

import type { CreateAgentSessionOptions, SessionManager, ToolDefinition } from "@code-yeongyu/senpi"

import { DEFAULT_CATEGORIES } from "../../category"
import { childEffectiveToolNames, escalatingHostTools } from "../../kernel-tools/nested-host-scope"
import { resolveKernelToolGrant } from "../../kernel-tools/resolve"
import { fakeKernelTools } from "./__fixtures__/kernel-tools-fakes"
import { buildChildSessionOptions } from "./child-options"
import { SENPI_SESSION_BUILTIN_NAMES } from "./host-tools"
import { mergeChildCustomTools } from "./shared-tool-filter"
import type { ChildSpec } from "../in-process"

const SENPI_DEFAULT_ACTIVE = ["read", "bash", "edit", "write", "grep"] as const

function tool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `parent tool ${name}`,
    parameters: Type.Object({}),
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: undefined }),
  }
}

function spec(policy: {
  readonly toolAllowlist?: readonly string[]
  readonly toolDenylist?: readonly string[]
  readonly memberScopedTools?: readonly ToolDefinition[]
} = {}): ChildSpec {
  return {
    taskId: "st_surface",
    cwd: process.cwd(),
    sessionDir: process.cwd(),
    depth: 1,
    parentSessionId: "parent",
    rootSessionId: "parent",
    prompt: "surface",
    ...policy,
  }
}

function runnerInstalled(options: CreateAgentSessionOptions): string[] {
  const custom = (options.customTools ?? []).map((entry) => entry.name)
  const registered = [...new Set([...SENPI_DEFAULT_ACTIVE, ...custom])]
  const deny = new Set(options.excludeTools ?? [])
  const allow = options.tools
  return registered.filter((name) => !deny.has(name) && (allow === undefined || allow.includes(name)))
}

function grantSide(
  parent: readonly ToolDefinition[],
  policy: { readonly toolAllowlist?: readonly string[]; readonly toolDenylist?: readonly string[] },
  memberScoped?: readonly ToolDefinition[],
): string[] {
  return [
    ...childEffectiveToolNames({
      childToolNames: mergeChildCustomTools(parent, memberScoped, { uiOnlyToolNames: ["memory"] }).map((entry) => entry.name),
      ...policy,
    }),
  ]
}

function runnerSide(
  parent: readonly ToolDefinition[],
  policy: { readonly toolAllowlist?: readonly string[]; readonly toolDenylist?: readonly string[] },
  memberScoped?: readonly ToolDefinition[],
): string[] {
  const options = buildChildSessionOptions({
    spec: spec({ ...policy, ...(memberScoped === undefined ? {} : { memberScopedTools: memberScoped }) }),
    sessionManager: {} as SessionManager,
    sharedParentTools: parent,
    uiOnlyToolNames: ["memory"],
  })
  return runnerInstalled(options)
}

describe("child tool surface is one list", () => {
  const parent = [tool("x_search"), tool("web_search"), tool("memory"), tool("task")]

  test("#given senpi session builtins #when the host-tool table is read #then it matches createAgentSession's default active names", () => {
    expect(SENPI_SESSION_BUILTIN_NAMES).toEqual([...SENPI_DEFAULT_ACTIVE])
  })

  test("#given every default category child #when grant-side and runner-installed sets are compared #then they are equal", () => {
    const policy = {}
    const grant = grantSide(parent, policy)
    const installed = runnerSide(parent, policy)
    expect(Object.keys(DEFAULT_CATEGORIES)).toContain("quick")
    expect(Object.keys(DEFAULT_CATEGORIES)).toContain("unspecified-high")
    expect(grant).toEqual(installed)
    expect(grant).toEqual(["read", "bash", "edit", "write", "grep", "x_search", "web_search"])
  })

  test("#given an allowlist agent and a denylist agent #when grant-side and runner-installed sets are compared #then they are equal", () => {
    const allow = { toolAllowlist: ["read", "x_search"] as const }
    const deny = { toolDenylist: ["write"] as const }
    const member = [tool("member_read")]
    expect(grantSide(parent, allow)).toEqual(runnerSide(parent, allow))
    expect(grantSide(parent, deny)).toEqual(runnerSide(parent, deny))
    expect(grantSide(parent, allow, member)).toEqual(runnerSide(parent, allow, member))
    expect(grantSide(parent, allow)).toEqual(["read", "x_search"])
    expect(grantSide(parent, deny)).toEqual(["read", "bash", "edit", "grep", "x_search", "web_search"])
  })

  test("#given a synthetic write-capable parent tool the child lacks #when the grant is resolved #then it is refused as tools_unavailable", async () => {
    const capability = fakeKernelTools()
    capability.define({ name: "lookup" })
    const names = mergeChildCustomTools([tool("synthetic_write")], undefined, {}).map((entry) => entry.name)
    const escalating = escalatingHostTools({ childToolNames: names, toolAllowlist: ["read"] })
    const resolved = await resolveKernelToolGrant({
      requestedNames: ["lookup"],
      capability,
      executionMode: "in-process",
      existingToolNames: names,
      toolAllowlist: ["read"],
    })

    expect(escalating).toContain("synthetic_write")
    expect(resolved).toMatchObject({ kind: "denied", code: "tools_unavailable" })
  })
})
