import { beforeEach, describe, expect, test } from "bun:test"

import { clearPendingStore, getPendingStoreSize } from "./store"
import { publishToolMetadata } from "./publish-tool-metadata"
import { recoverToolMetadata } from "./recover-tool-metadata"

describe("tool-metadata-store integration", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  test("#given stored metadata #when publishing then recovering #then the round trip preserves the payload", async () => {
    // given
    const payload = { title: "Task", metadata: { sessionId: "ses_child" } }

    // when
    await publishToolMetadata({ sessionID: "ses_parent", callID: "call_123" }, payload)
    const recovered = recoverToolMetadata("ses_parent", { callID: "call_123" })

    // then
    expect(recovered).toEqual(payload)
  })

  test("#given call id casing mismatch #when publishing and recovering #then canonical resolution still matches", async () => {
    // given
    const payload = { title: "Task", metadata: { sessionId: "ses_child" } }

    // when
    await publishToolMetadata({ sessionID: "ses_parent", callId: "call_case" }, payload)
    const recovered = recoverToolMetadata("ses_parent", { callID: "call_case" })

    // then
    expect(recovered).toEqual(payload)
  })

  test("#given blank call id #when publishing #then nothing is stored", async () => {
    // given
    const payload = { title: "Task" }

    // when
    const result = await publishToolMetadata({ sessionID: "ses_parent", callID: "   " }, payload)
    const recovered = recoverToolMetadata("ses_parent", { callID: "call_blank" })

    // then
    expect(result).toEqual({ stored: false })
    expect(recovered).toBeUndefined()
    expect(getPendingStoreSize()).toBe(0)
  })

  test("#given missing call id #when publishing #then nothing is stored", async () => {
    // given
    const payload = { title: "Task" }

    // when
    const result = await publishToolMetadata({ sessionID: "ses_parent" }, payload)

    // then
    expect(result).toEqual({ stored: false })
    expect(getPendingStoreSize()).toBe(0)
  })

  test("#given same session with different call ids #when publishing twice #then each entry stays isolated", async () => {
    // given
    await publishToolMetadata({ sessionID: "ses_parent", callID: "call_a" }, { title: "A" })
    await publishToolMetadata({ sessionID: "ses_parent", callID: "call_b" }, { title: "B" })

    // when
    const recoveredA = recoverToolMetadata("ses_parent", { callID: "call_a" })
    const recoveredB = recoverToolMetadata("ses_parent", { callID: "call_b" })

    // then
    expect(recoveredA).toEqual({ title: "A" })
    expect(recoveredB).toEqual({ title: "B" })
  })

  test("#given stale metadata #when a fresh entry is stored after the timeout #then stale entries are cleaned up", async () => {
    // given
    const originalDateNow = Date.now
    let now = 0
    Date.now = () => now

    try {
      await publishToolMetadata({ sessionID: "ses_parent", callID: "call_old" }, { title: "Old" })
      now = 15 * 60 * 1000 + 1

      // when
      await publishToolMetadata({ sessionID: "ses_parent", callID: "call_new" }, { title: "New" })

      // then
      expect(recoverToolMetadata("ses_parent", { callID: "call_old" })).toBeUndefined()
      expect(recoverToolMetadata("ses_parent", { callID: "call_new" })).toEqual({ title: "New" })
    } finally {
      Date.now = originalDateNow
    }
  })
})
