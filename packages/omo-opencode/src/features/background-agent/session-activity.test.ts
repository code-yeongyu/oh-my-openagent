/// <reference types="bun-types" />

import { describe, test, expect, mock } from "bun:test"
import { getSessionActivityFromClient } from "./session-activity"

describe("getSessionActivityFromClient", () => {
  test("#when client session get is not a function #then returns missing", async () => {
    // given
    const client = { session: {} }

    // when
    const result = await getSessionActivityFromClient(client as never, "ses-1")

    // then
    expect(result.type).toBe("missing")
  })

  test("#when client session get throws transport disconnect error #then returns missing", async () => {
    // given - this._client is undefined, causing TypeError
    const client = {
      session: {
        get: mock(() => Promise.reject(new TypeError("undefined is not an object (evaluating 'this._client')"))),
      },
    }

    // when
    const result = await getSessionActivityFromClient(client as never, "ses-1")

    // then - transport disconnect should be treated as session gone
    expect(result.type).toBe("missing")
  })

  test("#when client session get throws generic error #then returns unavailable", async () => {
    // given
    const client = {
      session: {
        get: mock(() => Promise.reject(new Error("network timeout"))),
      },
    }

    // when
    const result = await getSessionActivityFromClient(client as never, "ses-1")

    // then - generic errors still return unavailable
    expect(result.type).toBe("unavailable")
  })

  test("#when client session get returns not found error response #then returns missing", async () => {
    // given
    const client = {
      session: {
        get: mock(() => Promise.resolve({ error: { status: 404, message: "Session not found" } })),
      },
    }

    // when
    const result = await getSessionActivityFromClient(client as never, "ses-1")

    // then
    expect(result.type).toBe("missing")
  })

  test("#when client session get returns valid session data #then returns activity", async () => {
    // given
    const now = Date.now()
    const client = {
      session: {
        get: mock(() => Promise.resolve({ data: { id: "ses-1", time: { updated: now } } })),
      },
    }

    // when
    const result = await getSessionActivityFromClient(client as never, "ses-1")

    // then
    expect(result.type).toBe("activity")
    if (result.type === "activity") {
      expect(result.activity.getTime()).toBe(now)
    }
  })
})
