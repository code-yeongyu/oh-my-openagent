import { beforeEach, describe, expect, test } from "bun:test"

import { clearPendingStore, consumeToolMetadata } from "./store"
import { publishToolMetadata } from "./publish-tool-metadata"

describe("publishToolMetadata", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  test("#given metadata context and call id #when publishing #then it awaits metadata and stores the payload", async () => {
    // given
    const calls: string[] = []
    let metadataFinished = false
    const payload = { title: "Task", metadata: { sessionId: "ses_child" } }

    // when
    const result = await publishToolMetadata(
      {
        sessionID: "ses_parent",
        callID: "call_123",
        metadata: async input => {
          calls.push(input.title ?? "")
          await new Promise(resolve => setTimeout(resolve, 1))
          metadataFinished = true
        },
      },
      payload
    )

    // then
    expect(result).toEqual({ stored: true })
    expect(metadataFinished).toBe(true)
    expect(calls).toEqual(["Task"])
    expect(consumeToolMetadata("ses_parent", "call_123")).toEqual(payload)
  })

  test("#given legacy call id variant #when publishing #then it stores with the canonical resolver", async () => {
    // given
    const payload = { title: "Task", metadata: { sessionId: "ses_child" } }

    // when
    const result = await publishToolMetadata(
      {
        sessionID: "ses_parent",
        callId: " call_legacy ",
      },
      payload
    )

    // then
    expect(result).toEqual({ stored: true })
    expect(consumeToolMetadata("ses_parent", "call_legacy")).toEqual(payload)
  })

  test("#given missing call id #when publishing #then it still emits metadata but skips storing", async () => {
    // given
    let metadataCalls = 0

    // when
    const result = await publishToolMetadata(
      {
        sessionID: "ses_parent",
        metadata: () => {
          metadataCalls += 1
        },
      },
      { title: "Task" }
    )

    // then
    expect(result).toEqual({ stored: false })
    expect(metadataCalls).toBe(1)
    expect(consumeToolMetadata("ses_parent", "call_missing")).toBeUndefined()
  })
})
