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
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)

    pi.registerTool(fakeTool("lsp_diagnostics"))
    pi.registerTool(fakeTool("lsp_find_references"))
    pi.registerTool(fakeTool("task"))
    pi.registerTool(fakeTool("task_send"))

    const captured = registry.getCapturedTools()
    expect(captured.map((tool) => tool.name).sort()).toEqual(["lsp_diagnostics", "lsp_find_references", "task", "task_send"])
    expect(captured.every((tool) => typeof tool.execute === "function")).toBe(true)
    expect(pi.tools).toHaveLength(4)
  })

  it("#given captured tools #when filtered for a child #then lsp and process-child task tools remain", () => {
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)
    pi.registerTool(fakeTool("lsp_diagnostics"))
    pi.registerTool(fakeTool("task"))
    pi.registerTool(fakeTool("task_output"))
    pi.registerTool(fakeTool("task_send"))

    const shared = filterSharedParentTools(registry.getCapturedTools(), { includeTaskTools: true })

    expect(shared.map((tool) => tool.name)).toEqual(["lsp_diagnostics", "task", "task_output", "task_send"])
    expect(shared.every((tool) => typeof tool.execute === "function")).toBe(true)
  })

  it("#given a non-tool value #when registered #then it is not captured but still forwarded", () => {
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)

    pi.registerTool({ name: "not-a-tool" })

    expect(pi.tools).toHaveLength(1)
    expect(registry.getCapturedTools()).toHaveLength(0)
  })

  it("#given omo component registration is complete #when later builtins register #then they are forwarded but not shared with children", () => {
    const pi = new FakeExtensionAPI()
    const registry = installToolCaptureRegistry(pi)
    pi.registerTool(fakeTool("lsp_diagnostics"))

    registry.stopCapture()
    pi.registerTool(fakeTool("eval"))

    expect(pi.tools.map((tool) => tool.name)).toEqual(["lsp_diagnostics", "eval"])
    expect(registry.getCapturedTools().map((tool) => tool.name)).toEqual(["lsp_diagnostics"])
  })
})
