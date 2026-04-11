declare const require: (name: string) => any
const { describe, expect, mock, test, afterAll } = require("bun:test")
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDirs: string[] = []
const TEST_STORAGE_ROOT = join(tmpdir(), `recent-model-fallback-${Date.now()}`)
const TEST_MESSAGE_STORAGE = join(TEST_STORAGE_ROOT, "message")

mock.module("../../shared/opencode-storage-detection", () => ({
  isSqliteBackend: () => false,
}))

mock.module("../../shared/opencode-message-dir", () => ({
  getMessageDir: (sessionID: string) => {
    const directPath = join(TEST_MESSAGE_STORAGE, sessionID)
    return require("node:fs").existsSync(directPath) ? directPath : null
  },
}))

afterAll(() => {
  mock.restore()
  while (testDirs.length > 0) {
    const directory = testDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

describe("resolveRecentPromptContextForSession fallback ordering", () => {
  test("uses JSON fallback ordered by time.created when SDK messages fail", async () => {
    // given
    const sessionID = "ses_recent_model_fallback"
    const directory = mkdtempSync(join(tmpdir(), "recent-model-fallback-dir-"))
    testDirs.push(directory)
    const messageDir = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(messageDir, { recursive: true })
    writeFileSync(join(messageDir, "msg_ffff0000_000001.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      tools: { read: true },
      time: { created: 10 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_00000000_000999.json"), JSON.stringify({
      agent: "atlas",
      model: { providerID: "openai", modelID: "gpt-5.4" },
      tools: { edit: true },
      time: { created: 100 },
    }), "utf-8")

    const { resolveRecentPromptContextForSession } = await import("./recent-model-resolver")

    const ctx = {
      client: {
        session: {
          messages: async () => {
            throw new Error("sdk ordering unavailable")
          },
        },
      },
    }

    // when
    const result = await resolveRecentPromptContextForSession(ctx as never, sessionID)

    // then
    expect(result.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
    expect(result.tools).toEqual({ edit: true })
  })
})
