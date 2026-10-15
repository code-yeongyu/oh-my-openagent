import { expect, test } from "bun:test"
import type { Plugin } from "@opencode/plugin"
import { registerV1Hooks } from "./hook-bridge"

test("v2 context gives catalog precedence over imported legacy tool instructions", async () => {
  let onContext: (event: any) => Promise<void> = async () => {}
  const ctx = {
    session: {
      hook: async (name: string, handler: typeof onContext) => {
        if (name === "context") onContext = handler
      },
    },
  } as unknown as Plugin.Context
  const dispose = await registerV1Hooks(ctx, {
    "experimental.chat.system.transform": (_input: unknown, output: { system: string[] }) => {
      output.system.push("Legacy instruction: call mcp__lsp__get_tool_schema")
    },
  })
  try {
    const event = { sessionID: "child", model: { id: "claude", providerID: "anthropic" }, system: [] as { type: string; text: string }[] }
    await onContext(event)
    const guidance = event.system.at(-1)!.text
    expect(guidance).toContain("Code Mode")
    expect(guidance).toContain("search")
    expect(guidance).toContain("execute")
    expect(guidance).toContain("do not create callable tools")
    await onContext(event)
    expect(event.system.filter((part) => part.text === guidance)).toHaveLength(1)
  } finally {
    dispose()
  }
})
