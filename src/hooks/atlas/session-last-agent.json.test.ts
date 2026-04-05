declare const require: (name: string) => any
const { afterEach, describe, expect, mock, test, afterAll } = require("bun:test")
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const testDirs: string[] = []
const TEST_STORAGE_ROOT = join(tmpdir(), `atlas-session-last-agent-${Date.now()}`)
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

afterAll(() => { mock.restore() })

afterEach(() => {
  while (testDirs.length > 0) {
    const directory = testDirs.pop()
    if (directory) {
      rmSync(directory, { recursive: true, force: true })
    }
  }
})

function createTempMessageDir(sessionID: string): string {
  const directory = mkdtempSync(join(tmpdir(), "atlas-session-last-agent-json-"))
  testDirs.push(directory)
  const messageDir = join(TEST_MESSAGE_STORAGE, sessionID)
  mkdirSync(messageDir, { recursive: true })
  return messageDir
}

describe("getLastAgentFromSession JSON backend", () => {
  test("returns the newest non-compaction agent by message timestamp rather than filename order", async () => {
    // given
    const sessionID = "ses_json_last_agent"
    const messageDir = createTempMessageDir(sessionID)
    writeFileSync(join(messageDir, "msg_ffff0000_000001.json"), JSON.stringify({
      agent: "compaction",
      time: { created: 200 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_00000000_000999.json"), JSON.stringify({
      agent: "atlas",
      time: { created: 100 },
    }), "utf-8")
    writeFileSync(join(messageDir, "msg_11111111_000002.json"), JSON.stringify({
      agent: "sisyphus-junior",
      time: { created: 50 },
    }), "utf-8")

    const { getLastAgentFromSession } = await import("./session-last-agent")

    // when
    const result = await getLastAgentFromSession(sessionID)

    // then
    expect(result).toBe("atlas")
  })
})
