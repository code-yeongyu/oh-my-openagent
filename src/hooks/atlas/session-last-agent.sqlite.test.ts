const { describe, expect, mock, test, afterAll } = require("bun:test")

afterAll(() => { mock.restore() })

async function importFreshSessionLastAgentModule() {
  mock.module("../../shared/opencode-message-dir", () => ({
    getMessageDir: () => null,
  }))

  mock.module("../../shared/opencode-storage-detection", () => ({
    isSqliteBackend: () => true,
  }))

  const module = await import(`./session-last-agent?test=${Date.now()}-${Math.random()}`)
  mock.restore()
  return module
}

const { getLastAgentFromSession } = await importFreshSessionLastAgentModule()

function createMockClient(messages: Array<{ info?: { agent?: string } }>) {
  return {
    session: {
      messages: async () => ({ data: messages }),
    },
  }
}

describe("getLastAgentFromSession sqlite branch", () => {
  test("should skip compaction and return the previous real agent from sqlite messages", async () => {
    // given
    const client = createMockClient([
      { info: { agent: "atlas" } },
      { info: { agent: "compaction" } },
    ])

    // when
    const result = await getLastAgentFromSession("ses_sqlite_compaction", client)

    // then
    expect(result).toBe("atlas")
  })

  test("should return null when sqlite history contains only compaction", async () => {
    // given
    const client = createMockClient([{ info: { agent: "compaction" } }])

    // when
    const result = await getLastAgentFromSession("ses_sqlite_only_compaction", client)

    // then
    expect(result).toBeNull()
  })
})

export {}
