import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createResultSizeCapComponent } from "./component"

interface FakeTool extends Record<string, unknown> {
  name: string
  execute: (...args: unknown[]) => Promise<unknown>
}

function fakeTool(name: string, execute: FakeTool["execute"]): FakeTool {
  return { name, label: name, parameters: {}, execute }
}

describe("result-size-cap component", () => {
  it("#given a tool registered after the cap #when its result is oversized #then the result is truncated with a marker", async () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeTool("apply_patch", async () => ({ content: [{ type: "text", text: "x".repeat(5000) }] }))

    const component = createResultSizeCapComponent({ thresholdBytes: 100, headChars: 8, tailChars: 4 })
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    const result = (await tool.execute("call-1", {}, undefined, undefined, {})) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toContain("<truncated:")
    expect(result.content[0].text.length).toBeLessThan(200)
  })

  it("#given a tool registered after the cap #when its result is small #then it passes through unchanged", async () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeTool("bash", async () => ({ content: [{ type: "text", text: "ok" }] }))

    const component = createResultSizeCapComponent({ thresholdBytes: 100 })
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    const result = (await tool.execute("call-1", {}, undefined, undefined, {})) as { content: Array<{ text: string }> }
    expect(result.content[0].text).toBe("ok")
  })

  it("#given a tool whose execute throws #then the error still propagates", async () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeTool("bash", async () => {
      throw new Error("boom")
    })

    const component = createResultSizeCapComponent({ thresholdBytes: 100 })
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    await expect(tool.execute("call-1", {}, undefined, undefined, {})).rejects.toThrow("boom")
  })

  it("#given a guarded tool registration #then the tool still reaches the underlying registry", () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeTool("bash", async () => ({ content: [] }))

    const component = createResultSizeCapComponent()
    void component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    expect(pi.tools).toHaveLength(1)
    expect(pi.tools[0]).toBe(tool)
  })
})
