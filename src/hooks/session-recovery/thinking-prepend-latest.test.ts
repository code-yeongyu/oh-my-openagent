/// <reference types="bun-types" />
import { describe, expect, it, mock } from "bun:test"

const { prependThinkingPart, prependThinkingPartAsync } = await import("./storage/thinking-prepend")

type StoredPartRecord = {
  id: string
  sessionID: string
  messageID: string
  type: string
  signature?: string
  thinking?: string
}

describe("thinking-prepend latest assistant preservation", () => {
  it("#given file-backed order recovery targets the latest assistant #when prepending thinking #then it refuses to write copied thinking", () => {
    const sessionID = "ses_latest_file_backed_prepend"
    const targetMessageID = "msg_latest_file_backed"
    const previousThinkingPart = {
      id: "prt_previous_thinking",
      sessionID,
      messageID: "msg_previous_assistant",
      type: "thinking",
      thinking: "prior signed thinking",
      signature: "sig_previous",
    } as const satisfies StoredPartRecord
    const deps = {
      isSqliteBackend: () => false,
      patchPart: async () => true,
      log: mock(() => {}),
      findLastThinkingPart: () => previousThinkingPart,
      findLastThinkingPartFromSDK: async () => null,
      readTargetPartIDs: () => ["prt_target_text"],
      readTargetPartIDsFromSDK: async () => [],
      isLatestAssistantMessage: () => true,
      isLatestAssistantMessageFromSDK: async () => false,
    }

    const result = prependThinkingPart(sessionID, targetMessageID, deps)

    expect(result).toBe(false)
  })

  it("#given sdk order recovery targets the latest assistant #when prepending thinking #then it refuses to patch copied thinking", async () => {
    const sessionID = "ses_latest_sdk_prepend"
    const targetMessageID = "msg_latest_sdk"
    const patchPartMock = mock(async () => true)
    const previousThinkingPart = {
      id: "prt_previous_sdk_thinking",
      type: "thinking",
      thinking: "prior signed thinking",
      signature: "sig_previous_sdk",
    } as const
    const client = {
      session: {
        messages: async () => ({ data: [] }),
      },
    }
    const deps = {
      isSqliteBackend: () => false,
      patchPart: patchPartMock,
      log: mock(() => {}),
      findLastThinkingPart: () => null,
      findLastThinkingPartFromSDK: async () => previousThinkingPart,
      readTargetPartIDs: () => [],
      readTargetPartIDsFromSDK: async () => ["prt_target_text"],
      isLatestAssistantMessage: () => false,
      isLatestAssistantMessageFromSDK: async () => true,
    }
    const prependThinkingPartAsyncUntyped = Reflect.get(
      { prependThinkingPartAsync },
      "prependThinkingPartAsync",
    )

    const result = await Reflect.apply(prependThinkingPartAsyncUntyped, undefined, [
      client,
      sessionID,
      targetMessageID,
      deps,
    ])

    expect(result).toBe(false)
    expect(patchPartMock).toHaveBeenCalledTimes(0)
  })
})
