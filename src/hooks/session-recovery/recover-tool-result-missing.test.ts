import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import type { MessageData } from "./types"

let sqliteBackend = false
let storedParts: Array<{ type: string; id?: string; callID?: string; [key: string]: unknown }> = []

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => sqliteBackend,
}))

mock.module("./storage", () => ({
  readParts: () => storedParts,
}))

const { recoverToolResultMissing } = await import("./recover-tool-result-missing")

const failedAssistantMsg: MessageData = {
  info: { id: "msg_failed", role: "assistant" },
  parts: [],
}

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

describe("recoverToolResultMissing", () => {
  beforeEach(() => {
    sqliteBackend = false
    storedParts = []
  })

  afterEach(() => {
    mock.restore()
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

  it("pins agent, model, and variant on promptAsync body when resumeConfig provides them", async () => {
    // given
    storedParts = [{
      type: "tool",
      id: "prt_stored_pin_call",
      callID: "toolu_pin",
      tool: "bash",
      state: { input: {} },
    }]
    const { client, promptAsync } = createMockClient()
    const resumeConfig = {
      sessionID: "ses_pin",
      agent: "Hephaestus",
      model: { providerID: "openai", modelID: "gpt-5.3-codex", variant: "max" },
    }

    // when
    const result = await recoverToolResultMissing(client, "ses_pin", failedAssistantMsg, resumeConfig)

    // then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    const call = promptAsync.mock.calls[0]?.[0] as {
      body: {
        agent?: string
        model?: { providerID: string; modelID: string }
        variant?: string
        parts: unknown[]
      }
    }
    expect(call.body.agent).toBe("Hephaestus")
    expect(call.body.model).toEqual({ providerID: "openai", modelID: "gpt-5.3-codex" })
    expect(call.body.variant).toBe("max")
  })

  it("leaves body unchanged when no resumeConfig is provided", async () => {
    // given
    storedParts = [{
      type: "tool",
      id: "prt_stored_nopin_call",
      callID: "toolu_nopin",
      tool: "bash",
      state: { input: {} },
    }]
    const { client, promptAsync } = createMockClient()

    // when
    const result = await recoverToolResultMissing(client, "ses_nopin", failedAssistantMsg)

    // then
    expect(result).toBe(true)
    const call = promptAsync.mock.calls[0]?.[0] as { body: Record<string, unknown> }
    expect(call.body).not.toHaveProperty("agent")
    expect(call.body).not.toHaveProperty("model")
    expect(call.body).not.toHaveProperty("variant")
  })
})

export {}
