import { describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OpencodeClient } from "./opencode-client"
import { getSessionActivityFromClient } from "./session-activity"

class ReceiverSensitiveSessionApi {
  private readonly client = { ready: true }

  get(input: { path: { id: string }; query?: { directory?: string } }) {
    if (!this.client.ready) throw new Error("client unavailable")
    return Promise.resolve({
      data: {
        id: input.path.id,
        directory: input.query?.directory,
        time: { updated: 1_700_000_000_000 },
      },
    })
  }
}

describe("getSessionActivityFromClient", () => {
  test("preserves the session API receiver", async () => {
    const client = unsafeTestValue<OpencodeClient>({
      session: new ReceiverSensitiveSessionApi(),
    })

    const result = await getSessionActivityFromClient(client, "ses-1", "/tmp/project")

    expect(result).toEqual({
      type: "activity",
      activity: new Date(1_700_000_000_000),
    })
  })
})
