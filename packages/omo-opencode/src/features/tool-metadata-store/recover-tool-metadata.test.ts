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

  test("#given metadata stored under a diverging session id #when recovering with the same call id #then the payload is recovered once", () => {
    // given
    const payload = { title: "Background explore", metadata: { sessionId: "ses_child_explore" } }
    storeToolMetadata("ses_child_explore", "call_abc123", payload)

    // when
    const recovered = recoverToolMetadata("ses_parent_main", { callID: "call_abc123" })
    const consumedAgain = recoverToolMetadata("ses_child_explore", { callID: "call_abc123" })

    // then
    expect(recovered).toEqual(payload)
    expect(consumedAgain).toBeUndefined()
  })

  test("#given the same call id stored in own and foreign sessions #when recovering #then the own session entry wins", () => {
    // given
    const ownPayload = { title: "Own session" }
    const foreignPayload = { title: "Foreign session" }
    storeToolMetadata("ses_own", "call_dup", ownPayload)
    storeToolMetadata("ses_foreign", "call_dup", foreignPayload)

    // when
    const recovered = recoverToolMetadata("ses_own", { callID: "call_dup" })

    // then
    expect(recovered).toEqual(ownPayload)
  })

  test("#given the same call id pending in multiple foreign sessions #when recovering #then the ambiguous match is declined", () => {
    // given
    storeToolMetadata("ses_a", "call_collide", { title: "A" })
    storeToolMetadata("ses_b", "call_collide", { title: "B" })

    // when
    const recovered = recoverToolMetadata("ses_other", { callID: "call_collide" })

    // then
    expect(recovered).toBeUndefined()
    expect(recoverToolMetadata("ses_a", { callID: "call_collide" })).toEqual({ title: "A" })
    expect(recoverToolMetadata("ses_b", { callID: "call_collide" })).toEqual({ title: "B" })
  })
})
