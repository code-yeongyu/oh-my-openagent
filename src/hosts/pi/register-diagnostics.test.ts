import { describe, expect, test } from "bun:test"
import type { PiCommandOptions, PiExtensionApi, PiToolDefinition } from "./extension-api"
import ohMyOpenAgentPiExtension from "./index"
import { PI_DIAGNOSTIC_COMMAND, PI_DIAGNOSTIC_TOOL } from "./manifest"

function createFakeApi(): {
  api: PiExtensionApi
  commands: Map<string, PiCommandOptions>
  tools: Map<string, PiToolDefinition>
} {
  const commands = new Map<string, PiCommandOptions>()
  const tools = new Map<string, PiToolDefinition>()

  return {
    commands,
    tools,
    api: {
      sendUserMessage: () => {},
      on: () => {},
      registerCommand: (name, options) => {
        commands.set(name, options)
      },
      registerTool: (tool) => {
        tools.set(tool.name, tool)
      },
    },
  }
}

describe("Pi adapter", () => {
  test("#given extension API #when loaded #then registers diagnostic surfaces", async () => {
    // given
    const fake = createFakeApi()

    // when
    ohMyOpenAgentPiExtension(fake.api)

    // then
    expect(fake.commands.has(PI_DIAGNOSTIC_COMMAND)).toBe(true)
    expect(fake.tools.has(PI_DIAGNOSTIC_TOOL)).toBe(true)

    const tool = fake.tools.get(PI_DIAGNOSTIC_TOOL)
    const result = await tool?.execute("call-1", {}, undefined)
    expect(result?.content[0]?.text).toContain("Pi adapter loaded")
  })
})
