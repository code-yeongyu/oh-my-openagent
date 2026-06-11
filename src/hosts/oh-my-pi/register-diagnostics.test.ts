import { describe, expect, test } from "bun:test"
import type { OhMyPiCommandOptions, OhMyPiExtensionApi, OhMyPiToolDefinition } from "./extension-api"
import ohMyOpenAgentOhMyPiExtension from "./index"
import {
  OH_MY_PI_DIAGNOSTIC_COMMAND,
  OH_MY_PI_DIAGNOSTIC_TOOL,
  OH_MY_PI_EXTENSION_LABEL,
} from "./manifest"

function createFakeApi(): {
  api: OhMyPiExtensionApi
  labels: string[]
  commands: Map<string, OhMyPiCommandOptions>
  tools: Map<string, OhMyPiToolDefinition>
} {
  const labels: string[] = []
  const commands = new Map<string, OhMyPiCommandOptions>()
  const tools = new Map<string, OhMyPiToolDefinition>()

  return {
    labels,
    commands,
    tools,
    api: {
      sendUserMessage: () => {},
      on: () => {},
      zod: {
        object: (shape) => ({ type: "object", shape }),
      },
      setLabel: (label) => {
        labels.push(label)
      },
      registerCommand: (name, options) => {
        commands.set(name, options)
      },
      registerTool: (tool) => {
        tools.set(tool.name, tool)
      },
    },
  }
}

describe("Oh My Pi adapter", () => {
  test("#given extension API #when loaded #then registers diagnostic surfaces", async () => {
    // given
    const fake = createFakeApi()

    // when
    ohMyOpenAgentOhMyPiExtension(fake.api)

    // then
    expect(fake.labels).toEqual([OH_MY_PI_EXTENSION_LABEL])
    expect(fake.commands.has(OH_MY_PI_DIAGNOSTIC_COMMAND)).toBe(true)
    expect(fake.tools.has(OH_MY_PI_DIAGNOSTIC_TOOL)).toBe(true)

    const tool = fake.tools.get(OH_MY_PI_DIAGNOSTIC_TOOL)
    const result = await tool?.execute("call-1", {}, undefined)
    expect(result?.content[0]?.text).toContain("adapter loaded")
  })
})
