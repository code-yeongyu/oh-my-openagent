import { describe, expect, mock, test } from "bun:test"

import type { OpencodeClient } from "./opencode-client"
import { checkSessionExistence, sanitizeBareSessionId, verifySessionExists } from "./session-existence"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"

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

describe("sanitizeBareSessionId", () => {
  test("strips known platform prefixes", () => {
    // given / when / then
    expect(sanitizeBareSessionId("opencode:ses_abc123")).toBe("ses_abc123")
    expect(sanitizeBareSessionId("codex:ses_abc123")).toBe("ses_abc123")
    expect(sanitizeBareSessionId("senpi:ses_abc123")).toBe("ses_abc123")
  })

  test("leaves bare session ids untouched", () => {
    // given / when / then
    expect(sanitizeBareSessionId("ses_abc123")).toBe("ses_abc123")
  })

  test("checkSessionExistence queries with the bare id", async () => {
    // given
    const get = mock(async () => ({ data: { id: "ses_abc123" } }))
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        get,
      },
    })

    // when
    const result = await checkSessionExistence(client, "opencode:ses_abc123")

    // then
    expect(result).toBe("exists")
    expect(get).toHaveBeenCalledWith({
      path: { id: "ses_abc123" },
    })
  })
})
