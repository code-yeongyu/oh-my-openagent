import { describe, it, expect, mock, beforeEach } from "bun:test"
import { recoverEmptyContentMessageFromSDK } from "./recover-empty-content-message-sdk"
import type { MessageData } from "./types"

function createMockClient(messages: MessageData[]) {
  return {
    session: {
      messages: mock(() => Promise.resolve({ data: messages })),
    },
  } as never
}

function createDeps(overrides?: Partial<Parameters<typeof recoverEmptyContentMessageFromSDK>[4]>) {
  return {
    placeholderText: "[recovered]",
    replaceEmptyTextPartsAsync: mock(() => Promise.resolve(false)),
    injectTextPartAsync: mock(() => Promise.resolve(false)),
    findMessagesWithEmptyTextPartsFromSDK: mock(() => Promise.resolve([] as string[])),
    ...overrides,
  }
}

const emptyMsg: MessageData = { info: { id: "msg_1", role: "assistant" }, parts: [] }
const contentMsg: MessageData = { info: { id: "msg_2", role: "assistant" }, parts: [{ type: "text", text: "Hello" }] }
const thinkingOnlyMsg: MessageData = { info: { id: "msg_3", role: "assistant" }, parts: [{ type: "thinking", text: "hmm" }] }

describe("recoverEmptyContentMessageFromSDK", () => {
  it("returns false when no empty messages exist", async () => {
    //#given
    const client = createMockClient([contentMsg])
    const deps = createDeps()

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", contentMsg, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(false)
  })

  it("fixes messages with empty text parts via replace", async () => {
    //#given
    const client = createMockClient([emptyMsg])
    const deps = createDeps({
      findMessagesWithEmptyTextPartsFromSDK: mock(() => Promise.resolve(["msg_1"])),
      replaceEmptyTextPartsAsync: mock(() => Promise.resolve(true)),
    })

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", emptyMsg, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(true)
  })

  it("injects text part into thinking-only messages", async () => {
    //#given
    const client = createMockClient([thinkingOnlyMsg])
    const deps = createDeps({
      injectTextPartAsync: mock(() => Promise.resolve(true)),
    })

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", thinkingOnlyMsg, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(true)
    expect(deps.injectTextPartAsync).toHaveBeenCalledWith(
      client, "ses_1", "msg_3", "[recovered]",
    )
  })

  it("targets message by index from error", async () => {
    //#given
    const client = createMockClient([contentMsg, emptyMsg])
    const error = new Error("messages: index 1 has empty content")
    const deps = createDeps({
      replaceEmptyTextPartsAsync: mock(() => Promise.resolve(true)),
    })

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", emptyMsg, error, deps,
    )

    //#then
    expect(result).toBe(true)
  })

  it("falls back to failedID when targetIndex fix fails", async () => {
    //#given
    const failedMsg: MessageData = { info: { id: "msg_fail" }, parts: [] }
    const client = createMockClient([contentMsg])
    const deps = createDeps({
      replaceEmptyTextPartsAsync: mock(() => Promise.resolve(false)),
      injectTextPartAsync: mock(() => Promise.resolve(true)),
    })

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", failedMsg, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(true)
    expect(deps.injectTextPartAsync).toHaveBeenCalledWith(
      client, "ses_1", "msg_fail", "[recovered]",
    )
  })

  it("returns false when SDK throws during message read", async () => {
    //#given
    const client = { session: { messages: mock(() => Promise.reject(new Error("SDK error"))) } } as never
    const deps = createDeps()

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", emptyMsg, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(false)
  })

  it("scans all empty messages when no target index available", async () => {
    //#given
    const empty1: MessageData = { info: { id: "e1" }, parts: [] }
    const empty2: MessageData = { info: { id: "e2" }, parts: [] }
    const client = createMockClient([empty1, empty2])
    const replaceMock = mock(() => Promise.resolve(true))
    const deps = createDeps({ replaceEmptyTextPartsAsync: replaceMock })

    //#when
    const result = await recoverEmptyContentMessageFromSDK(
      client, "ses_1", empty1, new Error("test"), deps,
    )

    //#then
    expect(result).toBe(true)
  })
})
