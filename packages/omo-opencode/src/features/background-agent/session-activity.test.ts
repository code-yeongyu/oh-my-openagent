import { describe, expect, mock, test } from "bun:test"

import type { OpencodeClient } from "./opencode-client"
import { getSessionActivityFromClient } from "./session-activity"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

describe("getSessionActivityFromClient", () => {
  test("returns activity when the session reports a recent update", async () => {
    // given
    const updated = Date.now() - 5_000
    const get = mock(async () => ({ data: { id: "ses-1", time: { updated } } }))
    const client = unsafeTestValue<OpencodeClient>({ session: { get } })

    // when
    const result = await getSessionActivityFromClient(client, "ses-1")

    // then
    expect(result).toEqual({ type: "activity", activity: new Date(updated) })
  })

  test("treats a thrown transport-disconnect error as a missing session", async () => {
    // given
    const get = mock(async () => {
      throw new TypeError("undefined is not an object (evaluating 'this._client')")
    })
    const client = unsafeTestValue<OpencodeClient>({ session: { get } })

    // when
    const result = await getSessionActivityFromClient(client, "ses-1")

    // then
    expect(result).toEqual({ type: "missing" })
  })

  test("treats a transport-disconnect error response as a missing session", async () => {
    // given
    const get = mock(async () => ({ error: { message: "Not connected" }, data: undefined }))
    const client = unsafeTestValue<OpencodeClient>({ session: { get } })

    // when
    const result = await getSessionActivityFromClient(client, "ses-1")

    // then
    expect(result).toEqual({ type: "missing" })
  })

  test("keeps a transient lookup error as unavailable", async () => {
    // given
    const get = mock(async () => {
      throw new Error("Network timeout")
    })
    const client = unsafeTestValue<OpencodeClient>({ session: { get } })

    // when
    const result = await getSessionActivityFromClient(client, "ses-1")

    // then
    expect(result).toEqual({ type: "unavailable" })
  })
})
