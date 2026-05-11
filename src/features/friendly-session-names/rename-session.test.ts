import { afterEach, beforeEach, describe, test, expect, mock } from "bun:test"
import {
  applyFriendlySessionName,
  _resetFriendlySessionNamesForTesting,
} from "./rename-session"

beforeEach(() => {
  _resetFriendlySessionNamesForTesting()
})

afterEach(() => {
  _resetFriendlySessionNamesForTesting()
})

function createClient(
  override: Partial<{ updateImpl: (args: { path: { id: string }; body: { title?: string } }) => Promise<unknown> }> = {},
) {
  const update = mock(override.updateImpl ?? (async () => ({})))
  return {
    client: { session: { update } },
    update,
  }
}

describe("applyFriendlySessionName", () => {
  test("renames an eligible main session and returns the new title", async () => {
    // given
    const { client, update } = createClient()
    const generate = () => "strawberry-carrot"

    // when
    const result = await applyFriendlySessionName({
      client,
      sessionID: "ses-123",
      isSubagent: false,
      currentTitle: undefined,
      generate,
    })

    // then
    expect(result).toBe("strawberry-carrot")
    expect(update).toHaveBeenCalledTimes(1)
    expect(update).toHaveBeenCalledWith({ path: { id: "ses-123" }, body: { title: "strawberry-carrot" } })
  })

  test("skips subagent sessions", async () => {
    // given
    const { client, update } = createClient()

    // when
    const result = await applyFriendlySessionName({
      client,
      sessionID: "ses-sub",
      isSubagent: true,
      currentTitle: undefined,
      generate: () => "kiwi-pea",
    })

    // then
    expect(result).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  test("skips when title is already friendly", async () => {
    // given
    const { client, update } = createClient()

    // when
    const result = await applyFriendlySessionName({
      client,
      sessionID: "ses-already-named",
      isSubagent: false,
      currentTitle: "mango-spinach",
      generate: () => "kiwi-pea",
    })

    // then
    expect(result).toBeUndefined()
    expect(update).not.toHaveBeenCalled()
  })

  test("dedupes repeated calls per session id", async () => {
    // given
    const { client, update } = createClient()
    const generate = () => "strawberry-carrot"

    // when
    await applyFriendlySessionName({ client, sessionID: "ses-dup", isSubagent: false, currentTitle: undefined, generate })
    await applyFriendlySessionName({ client, sessionID: "ses-dup", isSubagent: false, currentTitle: undefined, generate })

    // then
    expect(update).toHaveBeenCalledTimes(1)
  })

  test("retries on the next call when the SDK update rejects", async () => {
    // given
    let calls = 0
    const updateImpl = async () => {
      calls += 1
      if (calls === 1) throw new Error("boom")
      return {}
    }
    const { client } = createClient({ updateImpl })

    // when
    const first = await applyFriendlySessionName({
      client,
      sessionID: "ses-retry",
      isSubagent: false,
      currentTitle: undefined,
      generate: () => "kiwi-pea",
    })
    const second = await applyFriendlySessionName({
      client,
      sessionID: "ses-retry",
      isSubagent: false,
      currentTitle: undefined,
      generate: () => "lemon-radish",
    })

    // then
    expect(first).toBeUndefined()
    expect(second).toBe("lemon-radish")
    expect(calls).toBe(2)
  })
})
