import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { AgentToolResult, CreateAgentSessionOptions, ToolDefinition } from "@code-yeongyu/senpi"

import { createKernelToolBindings } from "../../kernel-tools/bindings"
import { recordedKernelToolNames } from "../../kernel-tools/transcript-names"
import { resolveKernelToolGrant, type KernelToolGrant } from "../../kernel-tools/resolve"
import { InProcessRunner, type ChildSession, type ChildSpec } from "../in-process"
import { fakeKernelTools, type FakeKernelToolsCapability } from "./__fixtures__/kernel-tools-fakes"

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function project(): string {
  const root = mkdtempSync(join(tmpdir(), "omp-o6-revive-"))
  roots.push(root)
  return root
}

function transcript(root: string, usedToolNames: readonly string[]): string {
  const dir = join(root, "sessions")
  mkdirSync(dir, { recursive: true })
  const path = join(dir, "child.jsonl")
  const lines = [JSON.stringify({ type: "session", id: "child-session" })]
  for (const [index, name] of usedToolNames.entries()) {
    lines.push(JSON.stringify({
      type: "message",
      id: `call-${index}`,
      message: { role: "assistant", content: [{ type: "toolCall", id: `c${index}`, name, arguments: {} }] },
    }))
    lines.push(JSON.stringify({
      type: "message",
      id: `result-${index}`,
      message: {
        role: "toolResult",
        toolCallId: `c${index}`,
        toolName: name,
        content: [{ type: "text", text: JSON.stringify({ kernel_tool: name, value: "recorded" }) }],
      },
    }))
  }
  writeFileSync(path, `${lines.join("\n")}\n`)
  return path
}

function fakeSession(): ChildSession {
  return {
    sessionId: "child-session",
    prompt: async () => undefined,
    steer: async () => undefined,
    followUp: async () => undefined,
    abort: async () => undefined,
    subscribe: () => () => undefined,
    getLastAssistantText: () => undefined,
    dispose: () => undefined,
  }
}

function spec(root: string, overrides: Partial<ChildSpec> = {}): ChildSpec {
  return {
    taskId: "st_00000901",
    cwd: root,
    sessionDir: `${join(root, "sessions")}/`,
    depth: 1,
    parentSessionId: "parent",
    rootSessionId: "parent",
    prompt: "work",
    ...overrides,
  } as ChildSpec
}

function sharedTool(name: string): ToolDefinition {
  return {
    name,
    label: name,
    description: `shared parent tool ${name}`,
    parameters: { type: "object", properties: {}, additionalProperties: false } as never,
    execute: async () => ({ content: [{ type: "text", text: "live" }], details: undefined }),
  }
}

function harness(sharedParentTools: readonly ToolDefinition[] = []) {
  const bindings = createKernelToolBindings()
  const captured: CreateAgentSessionOptions[] = []
  const runner = new InProcessRunner({
    kernelToolBindings: bindings,
    sharedParentTools,
    createSession: async (options) => {
      captured.push(options)
      return fakeSession()
    },
  })
  const tools = (): readonly ToolDefinition[] => captured.at(-1)?.customTools ?? []
  const toolNamed = (name: string): ToolDefinition => {
    const found = tools().find((tool) => tool.name === name)
    if (found === undefined) throw new Error(`child has no tool ${name}`)
    return found
  }
  return { bindings, runner, captured, tools, toolNamed }
}

async function callTool(tool: ToolDefinition, args: Record<string, unknown> = {}): Promise<AgentToolResult<unknown>> {
  return (await tool.execute("call-1", args as never, undefined, undefined, {} as never)) as AgentToolResult<unknown>
}

function errorCode(result: AgentToolResult<unknown>): string | undefined {
  const details = result.details
  if (typeof details !== "object" || details === null || !("error" in details)) return undefined
  return (details as { error?: { code?: string } }).error?.code
}

async function grantFor(capability: FakeKernelToolsCapability, runs: { value: number }): Promise<KernelToolGrant> {
  capability.define({
    name: "fixture_lookup",
    run: () => {
      runs.value += 1
      return "parent-state"
    },
  })
  const resolved = await resolveKernelToolGrant({
    requestedNames: ["fixture_lookup"],
    capability,
    executionMode: "in-process",
  })
  if (resolved.kind !== "granted") throw new Error(`expected a grant, got ${resolved.kind}`)
  return resolved.grant
}

describe("revived child kernel tools", () => {
  test("#given a same-host parked child #when it is revived in the same live parent #then its originally granted tool still runs", async () => {
    const root = project()
    const path = transcript(root, ["fixture_lookup"])
    const capability = fakeKernelTools()
    const runs = { value: 0 }
    const { runner, toolNamed, bindings } = harness()
    await runner.start(spec(root, { kernelTools: await grantFor(capability, runs) }))

    // Parking drops the live handle but NOT the runtime binding.
    await runner.resume(spec(root), path)
    const result = await callTool(toolNamed("fixture_lookup"))

    expect(bindings.get("st_00000901")).toBeDefined()
    expect(errorCode(result)).toBeUndefined()
    expect(runs.value).toBe(1)
  })

  test("#given a parent kernel that reset before revival #when the revived child calls its tool #then the CHILD channel gets kernel_tool_stale and no closure runs", async () => {
    const root = project()
    const path = transcript(root, ["fixture_lookup"])
    const capability = fakeKernelTools()
    const runs = { value: 0 }
    const { runner, toolNamed } = harness()
    await runner.start(spec(root, { kernelTools: await grantFor(capability, runs) }))
    capability.reset()

    await runner.resume(spec(root), path)
    const result = await callTool(toolNamed("fixture_lookup"))

    expect(result.isError).toBe(true)
    expect(errorCode(result)).toBe("kernel_tool_stale")
    expect(runs.value).toBe(0)
  })

  test("#given a same-name redefinition #when the revived child calls the OLD descriptor #then the replacement closure never runs", async () => {
    const root = project()
    const path = transcript(root, ["fixture_lookup"])
    const capability = fakeKernelTools()
    const runs = { value: 0 }
    const replacements = { value: 0 }
    const { runner, toolNamed } = harness()
    await runner.start(spec(root, { kernelTools: await grantFor(capability, runs) }))
    capability.redefine("fixture_lookup", () => {
      replacements.value += 1
      return "replacement"
    })

    await runner.resume(spec(root), path)
    const stale = await callTool(toolNamed("fixture_lookup"))

    expect(errorCode(stale)).toBe("kernel_tool_stale")
    expect(replacements.value).toBe(0)

    // A NEW explicit spawn resolves the current descriptor and succeeds.
    const fresh = await resolveKernelToolGrant({ requestedNames: ["fixture_lookup"], capability, executionMode: "in-process" })
    if (fresh.kind !== "granted") throw new Error("the redefined tool must resolve for a new spawn")
    await runner.start(spec(root, { taskId: "st_00000902", kernelTools: fresh.grant }))
    const renewed = await callTool(toolNamed("fixture_lookup"))

    expect(errorCode(renewed)).toBeUndefined()
    expect(replacements.value).toBe(1)
  })

  test("#given a new host process with no binding #when the child is revived #then a transcript-named stub returns tools_unavailable without a capability call", async () => {
    const root = project()
    const path = transcript(root, ["fixture_lookup"])
    const capability = fakeKernelTools()
    const runs = { value: 0 }
    const first = harness()
    await first.runner.start(spec(root, { kernelTools: await grantFor(capability, runs) }))

    // A restart: a brand-new runner and a brand-new binding map, as a fresh host process has.
    const restarted = harness()
    await restarted.runner.resume(spec(root), path)
    const result = await callTool(restarted.toolNamed("fixture_lookup"))

    expect(result.isError).toBe(true)
    expect(errorCode(result)).toBe("tools_unavailable")
    expect(capability.invocations).toEqual([])
    expect(runs.value).toBe(0)
  })

  test("#given a released binding #when the revived child calls its tool #then the grant is typed unavailable instead of reaching a disposed kernel", async () => {
    const root = project()
    const path = transcript(root, ["fixture_lookup"])
    const capability = fakeKernelTools()
    const runs = { value: 0 }
    const { runner, toolNamed, bindings } = harness()
    await runner.start(spec(root, { kernelTools: await grantFor(capability, runs) }))
    await runner.resume(spec(root), path)
    const tool = toolNamed("fixture_lookup")

    bindings.release("st_00000901")
    const result = await callTool(tool)

    expect(errorCode(result)).toBe("tools_unavailable")
    expect(runs.value).toBe(0)
    expect(bindings.size).toBe(0)
  })

  test("#given a transcript naming a tool the child still has live #when revived #then no stub shadows it", async () => {
    const root = project()
    const path = transcript(root, ["shared_helper"])
    const { runner, tools } = harness([sharedTool("shared_helper")])

    await runner.resume(spec(root), path)

    const named = tools().filter((tool) => tool.name === "shared_helper")
    expect(named).toHaveLength(1)
    expect(await callTool(named[0] as ToolDefinition)).toMatchObject({ content: [{ type: "text", text: "live" }] })
    expect(recordedKernelToolNames(path)).toEqual(["shared_helper"])
  })

  test("#given a transcript without kernel-tool envelopes #when revived #then nothing is restored", async () => {
    const root = project()
    const path = transcript(root, [])
    const { runner, tools } = harness()

    await runner.resume(spec(root), path)

    expect(tools()).toEqual([])
    expect(recordedKernelToolNames(path)).toEqual([])
  })

})
