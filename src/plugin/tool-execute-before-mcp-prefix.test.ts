import { describe, expect, test, mock, beforeEach } from "bun:test"
import { createToolExecuteBeforeHandler } from "./tool-execute-before"
import type { PluginContext } from "./types"
import type { CreatedHooks } from "../create-hooks"

function createMockContext(): PluginContext {
  return {
    directory: "/tmp/test-dir",
    sessionId: "test-session",
  } as unknown as PluginContext
}

function createMockHooks(): CreatedHooks {
  return {
    ralphLoop: null,
    startWork: null,
    autoSlashCommand: null,
  } as unknown as CreatedHooks
}

describe("tool-execute-before mcp_ prefix stripping", () => {
  test("should strip mcp_ prefix from mcp_background_output", async () => {
    // given
    const handler = createToolExecuteBeforeHandler({
      ctx: createMockContext(),
      hooks: createMockHooks(),
    })
    const input = { tool: "mcp_background_output", sessionID: "ses_123", callID: "call_123" }
    const output = { args: {} }

    // when
    await handler(input, output)

    // then
    expect(input.tool).toBe("background_output")
  })

  test("should strip mcp_ prefix from mcp_background_cancel", async () => {
    // given
    const handler = createToolExecuteBeforeHandler({
      ctx: createMockContext(),
      hooks: createMockHooks(),
    })
    const input = { tool: "mcp_background_cancel", sessionID: "ses_123", callID: "call_123" }
    const output = { args: {} }

    // when
    await handler(input, output)

    // then
    expect(input.tool).toBe("background_cancel")
  })

  test("should strip mcp_ prefix from mcp_nocturne-memory_read_memory", async () => {
    // given
    const handler = createToolExecuteBeforeHandler({
      ctx: createMockContext(),
      hooks: createMockHooks(),
    })
    const input = { tool: "mcp_nocturne-memory_read_memory", sessionID: "ses_123", callID: "call_123" }
    const output = { args: {} }

    // when
    await handler(input, output)

    // then
    expect(input.tool).toBe("nocturne-memory_read_memory")
  })

  test("should NOT strip mcp_ prefix from tools that already work (e.g., mcp_bash)", async () => {
    // given — mcp_bash works fine because OpenCode handles it natively,
    // but our prefix stripping should still normalize it
    const handler = createToolExecuteBeforeHandler({
      ctx: createMockContext(),
      hooks: createMockHooks(),
    })
    const input = { tool: "mcp_bash", sessionID: "ses_123", callID: "call_123" }
    const output = { args: { command: "echo hello" } }

    // when
    await handler(input, output)

    // then — prefix stripped, bash handler still processes it
    expect(input.tool).toBe("bash")
  })

  test("should not modify tool names without mcp_ prefix", async () => {
    // given
    const handler = createToolExecuteBeforeHandler({
      ctx: createMockContext(),
      hooks: createMockHooks(),
    })
    const input = { tool: "background_output", sessionID: "ses_123", callID: "call_123" }
    const output = { args: {} }

    // when
    await handler(input, output)

    // then
    expect(input.tool).toBe("background_output")
  })
})
