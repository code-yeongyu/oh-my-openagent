const { describe, it, expect, mock, beforeEach, afterAll } = require("bun:test")

import type { MessageData } from "./types"

let sqliteBackend = false
let storedParts: Array<{ type: string; id?: string; callID?: string; [key: string]: unknown }> = []

afterAll(() => {
  mock.restore()
})

async function importFreshRecoverToolResultMissingModule() {
  mock.module("../../shared/opencode-storage-detection", () => ({
    isSqliteBackend: () => sqliteBackend,
  }))

  mock.module("./storage", () => ({
    readParts: () => storedParts,
  }))

  const module = await import(`./recover-tool-result-missing?test=${Date.now()}-${Math.random()}`)
  mock.restore()
  return module
}

const { recoverToolResultMissing } = await importFreshRecoverToolResultMissingModule()

function createMockClient(messages: MessageData[] = []) {
  const promptAsync = mock(() => Promise.resolve({}))

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

const failedAssistantMsg: MessageData = {
  info: { id: "msg_failed", role: "assistant" },
  parts: [],
}

describe("recoverToolResultMissing", () => {
  beforeEach(() => {
    sqliteBackend = false
    storedParts = []
  })

  it("returns false for sqlite fallback when tool part has no valid callID", async () => {
    //#given
    sqliteBackend = true
    const { client, promptAsync } = createMockClient([
      {
        info: { id: "msg_failed", role: "assistant" },
        parts: [{ type: "tool", id: "prt_missing_call", name: "bash", input: {} }],
      },
    ])

    //#when
    const result = await recoverToolResultMissing(client, "ses_1", failedAssistantMsg)

    //#then
    expect(result).toBe(false)
    expect(promptAsync).not.toHaveBeenCalled()
  })

  it("sends the recovered sqlite tool result when callID is valid", async () => {
    //#given
    sqliteBackend = true
    const { client, promptAsync } = createMockClient([
      {
        info: { id: "msg_failed", role: "assistant" },
        parts: [{ type: "tool", id: "prt_valid_call", callID: "call_recovered", name: "bash", input: {} }],
      },
    ])

    //#when
    const result = await recoverToolResultMissing(client, "ses_1", failedAssistantMsg)

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "ses_1" },
      body: {
        parts: [{
          type: "tool_result",
          tool_use_id: "call_recovered",
          content: "Operation cancelled by user (ESC pressed)",
        }],
      },
    })
  })

  it("returns false for stored parts when tool part has no valid callID", async () => {
    //#given
    storedParts = [{ type: "tool", id: "prt_stored_missing_call", tool: "bash", state: { input: {} } }]
    const { client, promptAsync } = createMockClient()

    //#when
    const result = await recoverToolResultMissing(client, "ses_2", failedAssistantMsg)

    //#then
    expect(result).toBe(false)
    expect(promptAsync).not.toHaveBeenCalled()
  })

  it("sends the recovered stored tool result when callID is valid", async () => {
    //#given
    storedParts = [{
      type: "tool",
      id: "prt_stored_valid_call",
      callID: "toolu_recovered",
      tool: "bash",
      state: { input: {} },
    }]
    const { client, promptAsync } = createMockClient()

    //#when
    const result = await recoverToolResultMissing(client, "ses_2", failedAssistantMsg)

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "ses_2" },
      body: {
        parts: [{
          type: "tool_result",
          tool_use_id: "toolu_recovered",
          content: "Operation cancelled by user (ESC pressed)",
        }],
      },
    })
  })
})

export {}
