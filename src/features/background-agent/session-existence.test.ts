import { describe, expect, mock, test } from "bun:test"

import type { OpencodeClient } from "./opencode-client"
import { checkSessionExistence, verifySessionExists } from "./session-existence"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"

describe("verifySessionExists", () => {
  test("passes query directory to session lookup when provided", async () => {
    // given
    const get = mock(async () => ({ data: { id: "session-123" } }))
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        get,
      },
    })

    // when
    const result = await verifySessionExists(client, "session-123", "/project/root")

    // then
    expect(result).toBe(true)
    expect(get).toHaveBeenCalledWith({
      path: { id: "session-123" },
      query: { directory: "/project/root" },
    })
  })

  test("classifies transient lookup errors as unknown", async () => {
    const get = mock(async () => ({
      error: { message: "Network timeout", status: 500 },
      data: undefined,
    }))
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        get,
      },
    })

    const result = await checkSessionExistence(client, "session-123")

    expect(result).toBe("unknown")
  })
})
