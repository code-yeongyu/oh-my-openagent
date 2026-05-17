import { beforeEach, describe, expect, test } from "bun:test"

import { recoverToolMetadata } from "./recover-tool-metadata"
import { clearPendingStore, storeToolMetadata } from "./store"

describe("recoverToolMetadata", () => {
  beforeEach(() => {
    clearPendingStore()
  })

  test("#given stored metadata and call id variant #when recovering #then it finds the stored payload", () => {
    // given
    const payload = { title: "Recovered", metadata: { sessionId: "ses_child" } }
    storeToolMetadata("ses_parent", "call_123", payload)

    // when
    const recovered = recoverToolMetadata("ses_parent", { callId: " call_123 " })

    // then
    expect(recovered).toEqual(payload)
  })

  test("#given direct string call id #when recovering #then it consumes the stored payload", () => {
    // given
    const payload = { title: "Recovered" }
    storeToolMetadata("ses_parent", "call_456", payload)

    // when
    const recovered = recoverToolMetadata("ses_parent", "call_456")

    // then
    expect(recovered).toEqual(payload)
  })

  test("#given missing or blank call id #when recovering #then it returns undefined", () => {
    // given
    storeToolMetadata("ses_parent", "call_789", { title: "Recovered" })

    // when
    const missing = recoverToolMetadata("ses_parent", undefined)
    const blank = recoverToolMetadata("ses_parent", { callID: "   " })

    // then
    expect(missing).toBeUndefined()
    expect(blank).toBeUndefined()
  })
})
