import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

import type { MessageData } from "./types"

let sqliteBackend = false
let storedParts: Array<{ type: string; id?: string; callID?: string; [key: string]: unknown }> = []

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => sqliteBackend,
}))

mock.module("./storage/parts-reader", () => ({
  readParts: () => storedParts,
  readPartsFromSDK: () => storedParts,
}))

const { recoverToolResultMissing } = await import("./recover-tool-result-missing")

const failedAssistantMsg: MessageData = {
  info: { id: "msg_failed", role: "assistant" },
  parts: [],
}

interface PromptAsyncInput {
  readonly path: { readonly id: string }
  readonly body: {
    readonly agent?: string
    readonly model?: { readonly providerID: string; readonly modelID: string }
    readonly variant?: string
    readonly parts: ReadonlyArray<{
      readonly toolUseId: string
      readonly content?: ReadonlyArray<{ readonly text: string }>
    }>
  }
}

function createMockClient(messages: MessageData[] = []) {
  const promptAsyncCalls: PromptAsyncInput[] = []
  const promptAsync = mock((input: PromptAsyncInput) => {
    promptAsyncCalls.push(input)
    return Promise.resolve({})
  })

  return {
    client: {
      session: {
        messages: mock(() => Promise.resolve({ data: messages })),
        promptAsync,
      },
    } as never,
    promptAsync,
    promptAsyncCalls,
  }
}

function firstPromptAsyncCall(calls: readonly PromptAsyncInput[]): PromptAsyncInput {
  const call = calls[0]
  if (!call) {
    throw new Error("expected promptAsync to be called at least once")
  }
  return call
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
          toolUseId: "call_recovered",
          tool_use_id: "call_recovered",
          isError: true,
          content: [{ type: "text", text: "Operation cancelled by user (ESC pressed)" }],
        }],
      },
    })
  })

  it("falls back to a valid id when callID is malformed", async () => {
    //#given
    const { client, promptAsync, promptAsyncCalls } = createMockClient()
    const failedAssistantWithMalformedCallID: MessageData = {
      info: { id: "msg_failed", role: "assistant" },
      parts: [{
        type: "tool_use",
        id: "toolu_recovered_from_id",
        callID: "prt_not_a_tool_use_id",
        state: { status: "running" },
      }],
    }

    //#when
    const result = await recoverToolResultMissing(client, "ses_1", failedAssistantWithMalformedCallID, undefined, {
      recoverStatuses: new Set(["pending", "running"]),
    })

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    const call = firstPromptAsyncCall(promptAsyncCalls)
    expect(call.body.parts.map((part) => part.toolUseId)).toEqual(["toolu_recovered_from_id"])
  })

  it("sends only interrupted sqlite tool results when recoverStatuses is provided", async () => {
    //#given
    sqliteBackend = true
    const { client, promptAsync, promptAsyncCalls } = createMockClient([
      {
        info: { id: "msg_failed", role: "assistant" },
        parts: [
          {
            type: "tool",
            id: "prt_completed_call",
            callID: "call_completed",
            name: "bash",
            input: {},
            state: { status: "completed" },
          },
          {
            type: "tool",
            id: "prt_running_call",
            callID: "call_running",
            name: "bash",
            input: {},
            state: { status: "running" },
          },
          {
            type: "tool",
            id: "prt_pending_call",
            callID: "toolu_pending",
            name: "task",
            input: {},
            state: { status: "pending" },
          },
        ],
      },
    ])

    //#when
    const result = await recoverToolResultMissing(client, "ses_1", failedAssistantMsg, undefined, {
      recoverStatuses: new Set(["pending", "running"]),
      resultText: "Tool execution was interrupted before producing a result.",
      source: "session-recovery-interrupted-tool-results",
    })

    //#then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    const call = firstPromptAsyncCall(promptAsyncCalls)
    expect(call.body.parts.map((part) => part.toolUseId)).toEqual(["call_running", "toolu_pending"])
    expect(call.body.parts[0]?.content?.[0]?.text).toBe("Tool execution was interrupted before producing a result.")
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
          toolUseId: "toolu_recovered",
          tool_use_id: "toolu_recovered",
          isError: true,
          content: [{ type: "text", text: "Operation cancelled by user (ESC pressed)" }],
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
    const { client, promptAsync, promptAsyncCalls } = createMockClient()
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
    const call = firstPromptAsyncCall(promptAsyncCalls)
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
    const { client, promptAsync, promptAsyncCalls } = createMockClient()

    // when
    const result = await recoverToolResultMissing(client, "ses_nopin", failedAssistantMsg)

    // then
    expect(result).toBe(true)
    expect(promptAsync).toHaveBeenCalledTimes(1)
    const call = firstPromptAsyncCall(promptAsyncCalls)
    expect(call.body).not.toHaveProperty("agent")
    expect(call.body).not.toHaveProperty("model")
    expect(call.body).not.toHaveProperty("variant")
  })
})

export {}
