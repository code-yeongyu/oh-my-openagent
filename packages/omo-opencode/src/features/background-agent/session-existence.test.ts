import { describe, expect, mock, test } from "bun:test"

import type { OpencodeClient } from "./opencode-client"
import { checkSessionExistence, verifySessionExists } from "./session-existence"
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

describe("checkSessionExistence with platform-prefixed session ids", () => {
  // Regression fixture for #6263: the storage layer resolves bare ids only,
  // so prefixed ids must be stripped before the SDK path or they 404.
  function createBareIdOnlyClient(): { client: OpencodeClient; requestedIds: string[] } {
    const requestedIds: string[] = []
    const get = mock(async (args: { path: { id: string } }) => {
      requestedIds.push(args.path.id)
      if (args.path.id === "ses_bare123") {
        return { data: { id: "ses_bare123" } }
      }
      return { error: { message: "Session not found", status: 404 }, data: undefined }
    })
    const client = unsafeTestValue<OpencodeClient>({
      session: {
        get,
      },
    })
    return { client, requestedIds }
  }

  test("#given an opencode:-prefixed session id #when existence is checked #then the bare id is looked up and the result matches the raw-id lookup", async () => {
    // given
    const { client, requestedIds } = createBareIdOnlyClient()

    // when
    const prefixedResult = await checkSessionExistence(client, "opencode:ses_bare123")
    const rawResult = await checkSessionExistence(client, "ses_bare123")

    // then
    expect(prefixedResult).toBe(rawResult)
    expect(prefixedResult).toBe("exists")
    expect(requestedIds[0]).toBe("ses_bare123")
  })

  test("#given codex:- or senpi:-prefixed session ids #when existence is checked #then the bare id is looked up for each platform prefix", async () => {
    // given
    const { client, requestedIds } = createBareIdOnlyClient()

    // when
    const codexResult = await checkSessionExistence(client, "codex:ses_bare123")
    const senpiResult = await checkSessionExistence(client, "senpi:ses_bare123")

    // then
    expect(codexResult).toBe("exists")
    expect(senpiResult).toBe("exists")
    expect(requestedIds).toEqual(["ses_bare123", "ses_bare123"])
  })

  test("#given a missing session behind a prefix #when existence is checked #then the result stays missing", async () => {
    // given
    const { client } = createBareIdOnlyClient()

    // when
    const result = await checkSessionExistence(client, "opencode:ses_gone999")

    // then
    expect(result).toBe("missing")
  })
})
