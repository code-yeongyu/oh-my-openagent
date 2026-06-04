/// <reference types="bun-types" />
import { existsSync, rmSync } from "node:fs"
import { randomUUID } from "node:crypto"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it, mock } from "bun:test"

const TEST_STORAGE_ROOT = join(tmpdir(), `session-recovery-latest-thinking-prepend-${randomUUID()}`)
const TEST_PART_STORAGE = join(TEST_STORAGE_ROOT, "part")

mock.module("../../shared", () => ({
  OPENCODE_STORAGE: TEST_STORAGE_ROOT,
  MESSAGE_STORAGE: join(TEST_STORAGE_ROOT, "message"),
  PART_STORAGE: TEST_PART_STORAGE,
  log: () => {},
  isSqliteBackend: () => false,
  patchPart: async () => true,
  normalizeSDKResponse: <TData>(response: { data?: TData }, fallback: TData) => response.data ?? fallback,
}))

afterAll(() => { mock.restore() })

const { prependThinkingPart, prependThinkingPartAsync } = await import("./storage/thinking-prepend")

type StoredPartRecord = {
  id: string
  sessionID: string
  messageID: string
  type: string
  signature?: string
  thinking?: string
}

function cleanupParts(messageID: string): void {
  rmSync(join(TEST_PART_STORAGE, messageID), { recursive: true, force: true })
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
    expect(existsSync(join(TEST_PART_STORAGE, targetMessageID))).toBe(false)
    cleanupParts(targetMessageID)
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
