import { describe, expect, it } from "bun:test"

import { filterSharedParentTools } from "@oh-my-opencode/senpi-task"

import { FakeExtensionAPI } from "../../test-support/fake-extension-api"
import { installToolCaptureRegistry } from "./tool-capture-registry"

interface FakeTool extends Record<string, unknown> {
  name: string
  execute: (...args: unknown[]) => Promise<unknown>
}

function fakeTool(name: string): FakeTool {
  return {
    name,
    label: name,
    parameters: {},
    execute: async () => ({ content: [] }),
  }
}

describe("tool capture registry", () => {
  it("#given components register tools #when captured #then every injected tool exposes a callable execute", () => {
    // given the wrapper is installed before any component registers (as compose does)
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)

    // when lsp-like tools register (earlier than task in the real loop), then task-family tools
    pi.registerTool(fakeTool("lsp_diagnostics"))
    pi.registerTool(fakeTool("lsp_find_references"))
    pi.registerTool(fakeTool("task"))
    pi.registerTool(fakeTool("task_send"))

    // then all four are captured, all with callable execute, and the underlying registerTool still ran
    const captured = registry.getCapturedTools()
    expect(captured.map((tool) => tool.name).sort()).toEqual(["lsp_diagnostics", "lsp_find_references", "task", "task_send"])
    expect(captured.every((tool) => typeof tool.execute === "function")).toBe(true)
    expect(pi.tools).toHaveLength(4)
  })

  it("#given captured tools #when filtered for a child #then lsp tools remain but the task/team family is excluded", () => {
    // given
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)
    pi.registerTool(fakeTool("lsp_diagnostics"))
    pi.registerTool(fakeTool("task"))
    pi.registerTool(fakeTool("task_output"))
    pi.registerTool(fakeTool("team_send_message"))

    // when the shared-parent-tools provider filters the capture registry
    const shared = filterSharedParentTools(registry.getCapturedTools())

    // then only the lsp tool is shareable with a child
    expect(shared.map((tool) => tool.name)).toEqual(["lsp_diagnostics"])
    expect(shared.every((tool) => typeof tool.execute === "function")).toBe(true)
  })

  it("#given a non-tool value #when registered #then it is not captured but still forwarded", () => {
    // given
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)

    // when a value without a callable execute is registered
    pi.registerTool({ name: "not-a-tool" })

    // then it is forwarded but not captured as a shareable tool
    expect(pi.tools).toHaveLength(1)
    expect(registry.getCapturedTools()).toHaveLength(0)
  })
})
