export {}
const { describe, expect, mock, test, afterAll } = require("bun:test")

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => true,
}))

afterAll(() => { mock.restore() })

const { getLastAgentFromSession } = await import("./session-last-agent")

describe("getLastAgentFromSession SQLite backend ordering", () => {
  test("returns newest non-compaction agent using time.created and id tie-breaker", async () => {
    // given
    const client = {
      session: {
        messages: async () => ({
          data: [
            { id: "msg_0001", info: { agent: "atlas", time: { created: 100 } } },
            { id: "msg_0003", info: { agent: "compaction", time: { created: 200 } } },
            { id: "msg_0002", info: { agent: "sisyphus-junior", time: { created: 100 } } },
          ],
        }),
      },
    }

    // when
    const result = await getLastAgentFromSession("ses_sqlite_last_agent", client as never)

    // then
    expect(result).toBe("sisyphus-junior")
  })

  test("handles equal timestamps with random-looking ids deterministically", async () => {
    // given
    const client = {
      session: {
        messages: async () => ({
          data: [
            { id: "msg_a91f00ab", info: { agent: "atlas", time: { created: 100 } } },
            { id: "msg_f0e1d2c3", info: { agent: "compaction", time: { created: 200 } } },
            { id: "msg_d4c3b2a1", info: { agent: "sisyphus-junior", time: { created: 100 } } },
          ],
        }),
      },
    }

    // when
    const result = await getLastAgentFromSession("ses_sqlite_last_agent_equal_time", client as never)

    // then
    expect(result).toBe("sisyphus-junior")
  })

  test("returns null instead of throwing when SQLite message lookup fails", async () => {
    // given
    const client = {
      session: {
        messages: async () => {
          throw new Error("sqlite lookup failed")
        },
      },
    }

    // when
    const result = await getLastAgentFromSession("ses_sqlite_error", client as never)

    // then
    expect(result).toBeNull()
  })
})
