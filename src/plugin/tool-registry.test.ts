import { describe, expect, test } from "bun:test"
import { tool } from "@opencode-ai/plugin"

import type { ToolsRecord } from "./types"
import { trimToolsToCap } from "./tool-registry"

const fakeTool = tool({
  description: "test tool",
  args: {},
  async execute(): Promise<string> {
    return "ok"
  },
})

describe("#given tool trimming prioritization", () => {
  test("#when max_tools trims a hashline edit registration named edit #then edit is removed before higher-priority tools", () => {
    const filteredTools = {
      bash: fakeTool,
      edit: fakeTool,
      read: fakeTool,
    } satisfies ToolsRecord

    trimToolsToCap(filteredTools, 2)

    expect(filteredTools).not.toHaveProperty("edit")
    expect(filteredTools).toHaveProperty("bash")
    expect(filteredTools).toHaveProperty("read")
  })
})
