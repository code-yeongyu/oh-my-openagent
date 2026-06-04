import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import type { MessageData } from "./types"

let sqliteBackend = false
let storedParts: Array<{ type: string; id?: string; callID?: string; name?: string; tool?: string; [key: string]: unknown }> = []

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => sqliteBackend,
}))

mock.module("./storage", () => ({
  readParts: () => storedParts,
}))

mock.module("./storage/parts-reader", () => ({
  readParts: () => storedParts,
}))

const { recoverUnavailableTool } = await import("./recover-unavailable-tool")

const failedAssistantMsg: MessageData = {
  info: { id: "msg_failed", role: "assistant", error: 'No such tool: bash' },
  parts: [],
}

function createMockClient(messages: MessageData[] = [], promptAsyncImpl?: () => Promise<unknown>) {
  const promptAsync = mock(() => promptAsyncImpl ? promptAsyncImpl() : Promise.resolve({}))

  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: messages })),
        promptAsync,
      },
    } as never,
    promptAsync,
  }
}

describe("recoverUnavailableTool", () => {
  beforeEach(() => {
    sqliteBackend = false
    storedParts = []
  })

  afterEach(() => {
    mock.restore()
    releaseAllPromptAsyncReservationsForTesting()
  })

  it("sends a schema-compatible recovered tool result for sqlite fallback", async () => {
    //#given
    sqliteBackend = true
    const { client, promptAsync } = createMockClient([
      {
        info: { id: "msg_failed", role: "assistant" },
        parts: [{ type: "tool", id: "prt_valid_call", callID: "call_recovered", name: "bash", input: {} }],
      },
    ])

    //#when
    const result = await recoverUnavailableTool(client, "ses_1", failedAssistantMsg)

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "ses_1" },
      body: {
        parts: [{
          type: "tool_result",
          toolUseId: "call_recovered",
          tool_use_id: "call_recovered",
          isError: true,
          content: [{ type: "text", text: '{"status":"error","error":"Tool not available. Please continue without this tool."}' }],
        }],
      },
    })
  })

  it("sends a schema-compatible recovered tool result for stored parts fallback", async () => {
    //#given
    storedParts = [{
      type: "tool",
      id: "prt_stored_valid_call",
      callID: "toolu_recovered",
      tool: "bash",
      state: { input: {} },
    }]
    const { client, promptAsync } = createMockClient([{
      info: { id: "msg_failed", role: "assistant" },
      parts: [{ type: "tool", id: "prt_stored_valid_call", callID: "toolu_recovered", name: "bash", input: {} }],
    }])

    //#when
    const result = await recoverUnavailableTool(client, "ses_2", failedAssistantMsg)

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "ses_2" },
      body: {
        parts: [{
          type: "tool_result",
          toolUseId: "toolu_recovered",
          tool_use_id: "toolu_recovered",
          isError: true,
          content: [{ type: "text", text: '{"status":"error","error":"Tool not available. Please continue without this tool."}' }],
        }],
      },
    })
  })

  it("#given unavailable-tool recovery may have been accepted before EOF #when promptAsync fails ambiguously #then recovery is treated as started", async () => {
    //#given
    const failedAssistantWithToolUse: MessageData = {
      info: { id: "msg_failed_eof", role: "assistant", error: "No such tool: bash" },
      parts: [{ type: "tool_use", id: "toolu_eof", name: "bash" }],
    }
    const { client, promptAsync } = createMockClient([], async () => {
      throw new Error("JSON Parse error: Unexpected EOF")
    })

    //#when
    const result = await recoverUnavailableTool(client, "ses_unavailable_eof", failedAssistantWithToolUse)

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledTimes(1)
  })
})
