import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OpencodeClient } from "./opencode-client"
import { getSessionActivityFromClient } from "./session-activity"

// A fake session API modeled after the generated OpenCode SDK: `get` is a real
// method that reads `this._client`. If the method is detached from its receiver
// (e.g. `const get = client.session.get; get(...)`), `this` becomes undefined
// and reading `this._client` throws, exactly like production.
class ThrowingIfDetachedSessionApi {
  private readonly _client = { internal: true }

  get(_input: { path: { id: string }; query?: { directory?: string } }): Promise<{ data: { time: { updated: number } } }> {
    if (!this._client) {
      throw new Error("undefined is not an object (evaluating 'this._client')")
    }
    return Promise.resolve({ data: { time: { updated: 1_700_000_000_000 } } })
  }
}

function createClientWith(session: unknown): OpencodeClient {
  return unsafeTestValue<OpencodeClient>({ session })
}

describe("getSessionActivityFromClient", () => {
  test("returns activity when session.get is a method that depends on its receiver", async () => {
    //#given - a client whose session.get throws unless called with its own `this`
    const client = createClientWith(new ThrowingIfDetachedSessionApi())

    //#when - resolving session activity through the client
    const result = await getSessionActivityFromClient(client, "ses-1")

    //#then - the method was invoked with `this` preserved and produced an activity timestamp
    expect(result.type).toBe("activity")
    if (result.type === "activity") {
      expect(result.activity).toEqual(new Date(1_700_000_000_000))
    }
  })

  test("forwards the directory query while preserving the receiver", async () => {
    //#given - a method-based session api that captures its received arguments and `this`
    const received: Array<{ path: { id: string }; query?: { directory?: string } }> = []
    class CapturingSessionApi {
      private readonly _client = {}
      get(input: { path: { id: string }; query?: { directory?: string } }): Promise<{ data: Record<string, never> }> {
        // Touch `this._client` so a detached call would throw before capturing.
        void this._client
        received.push(input)
        return Promise.resolve({ data: {} })
      }
    }
    const client = createClientWith(new CapturingSessionApi())

    //#when - resolving activity with an explicit directory
    await getSessionActivityFromClient(client, "ses-9", "/tmp/project")

    //#then - the call landed with the right path and query, proving `this` survived
    expect(received).toEqual([{ path: { id: "ses-9" }, query: { directory: "/tmp/project" } }])
  })

  test("returns missing when session.get is not a function", async () => {
    //#given - a fake client (plain object) that omits session.get entirely
    const client = createClientWith({})

    //#when - resolving session activity
    const result = await getSessionActivityFromClient(client, "ses-2")

    //#then - the existence guard short-circuits to missing without throwing
    expect(result.type).toBe("missing")
  })
})
