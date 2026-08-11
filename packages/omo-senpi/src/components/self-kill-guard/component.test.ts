import { describe, expect, it } from "bun:test"

import { FakeExtensionAPI } from "../../../test-support/fake-extension-api"
import { createSelfKillGuardComponent, SELF_KILL_GUARD_NOTICE_CUSTOM_TYPE } from "./component"

interface FakeTool extends Record<string, unknown> {
  name: string
  execute: (...args: unknown[]) => Promise<unknown>
}

function fakeBashTool(execute?: FakeTool["execute"]): FakeTool {
  return {
    name: "bash",
    label: "bash",
    parameters: {},
    execute: execute ?? (async () => ({ content: [] })),
  }
}

describe("self-kill-guard component", () => {
  it("#given a bash tool registered after the guard #when a self-terminating command runs #then it is refused and the original execute is not called", async () => {
    const pi = new FakeExtensionAPI()
    let originalCalled = false
    const tool = fakeBashTool(async () => {
      originalCalled = true
      return { content: [] }
    })

    const component = createSelfKillGuardComponent()
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    await expect(
      tool.execute("call-1", { command: "taskkill /F /IM node.exe /T" }, undefined, undefined, {}),
    ).rejects.toThrow(/omo-self-kill-guard/)
    await expect(
      tool.execute("call-1", { command: "taskkill /F /IM node.exe /T" }, undefined, undefined, {}),
    ).rejects.toThrow(/kill_bash/)
    expect(originalCalled).toBe(false)
  })

  it("#given a guarded bash tool #when a safe command runs #then it passes through to the original execute", async () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeBashTool()

    const component = createSelfKillGuardComponent()
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    const result = (await tool.execute("call-1", { command: "npm run dev -- --port 5173" }, undefined, undefined, {})) as {
      isError?: boolean
    }
    expect(result.isError).toBeUndefined()
  })

  it("#given bash_input with a self-terminating input #then it is refused", async () => {
    const pi = new FakeExtensionAPI()
    const tool: FakeTool = {
      name: "bash_input",
      label: "bash_input",
      parameters: {},
      execute: async () => ({ content: [] }),
    }

    const component = createSelfKillGuardComponent()
    await component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    await expect(tool.execute("call-1", { input: "taskkill //F //IM node.exe /T" }, undefined, undefined, {})).rejects.toThrow(
      /omo-self-kill-guard/,
    )
  })

  it("#given a tool_execution_start with a self-terminating command #then a visible notice is sent", () => {
    const pi = new FakeExtensionAPI()

    const component = createSelfKillGuardComponent()
    void component.register(pi, { logger: console, config: { getFlag: () => false } })

    const handler = pi.handlers.find((entry) => entry.event === "tool_execution_start")
    expect(handler).toBeDefined()
    handler?.handler({ toolName: "bash", args: { command: "pkill node" } })

    expect(pi.messages).toHaveLength(1)
    expect(pi.messages[0].message.customType).toBe(SELF_KILL_GUARD_NOTICE_CUSTOM_TYPE)
    expect(pi.messages[0].message.display).toBe(true)
    expect(String(pi.messages[0].message.content)).toContain("[omo-self-kill-guard]")
  })

  it("#given a tool_execution_start with a safe command #then no notice is sent", () => {
    const pi = new FakeExtensionAPI()

    const component = createSelfKillGuardComponent()
    void component.register(pi, { logger: console, config: { getFlag: () => false } })

    const handler = pi.handlers.find((entry) => entry.event === "tool_execution_start")
    handler?.handler({ toolName: "bash", args: { command: "npm run dev" } })

    expect(pi.messages).toHaveLength(0)
  })

  it("#given a guarded tool registration #then the tool still reaches the underlying registry", () => {
    const pi = new FakeExtensionAPI()
    const tool = fakeBashTool()

    const component = createSelfKillGuardComponent()
    void component.register(pi, { logger: console, config: { getFlag: () => false } })
    pi.registerTool(tool)

    expect(pi.tools).toHaveLength(1)
    expect(pi.tools[0]).toBe(tool)
  })
})
