import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

const TEST_DIR = join(tmpdir(), "omo-test-session-manager")
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_TODO_DIR = join(TEST_DIR, "todos")
const TEST_TRANSCRIPT_DIR = join(TEST_DIR, "transcripts")

mock.module("./constants", () => ({
  OPENCODE_STORAGE: TEST_DIR,
  MESSAGE_STORAGE: TEST_MESSAGE_STORAGE,
  PART_STORAGE: TEST_PART_STORAGE,
  TODO_DIR: TEST_TODO_DIR,
  TRANSCRIPT_DIR: TEST_TRANSCRIPT_DIR,
  SESSION_LIST_DESCRIPTION: "test",
  SESSION_READ_DESCRIPTION: "test",
  SESSION_SEARCH_DESCRIPTION: "test",
  SESSION_INFO_DESCRIPTION: "test",
  SESSION_DELETE_DESCRIPTION: "test",
  TOOL_NAME_PREFIX: "session_",
}))

const { getAllSessions, getMessageDir, sessionExists, readSessionMessages, readSessionTodos, getSessionInfo } =
  await import("./storage")

describe("session-manager storage", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
    mkdirSync(TEST_TRANSCRIPT_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("getAllSessions returns empty array when no sessions exist", async () => {
    // #when
    const sessions = await getAllSessions()

    // #then
    expect(Array.isArray(sessions)).toBe(true)
    expect(sessions).toEqual([])
  })

  test("getMessageDir finds session in direct path", () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001", role: "user" }))

    // #when
    const result = getMessageDir(sessionID)

    // #then
    expect(result).toBe(sessionPath)
  })

  test("sessionExists returns false for non-existent session", () => {
    // #when
    const exists = sessionExists("ses_nonexistent")

    // #then
    expect(exists).toBe(false)
  })

  test("sessionExists returns true for existing session", () => {
    // #given
    const sessionID = "ses_exists"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001" }))

    // #when
    const exists = sessionExists(sessionID)

    // #then
    expect(exists).toBe(true)
  })

  test("readSessionMessages returns empty array for non-existent session", async () => {
    // #when
    const messages = await readSessionMessages("ses_nonexistent")

    // #then
    expect(messages).toEqual([])
  })

  test("readSessionMessages sorts messages by timestamp", async () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({ id: "msg_002", role: "assistant", time: { created: 2000 } })
    )
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({ id: "msg_001", role: "user", time: { created: 1000 } })
    )

    // #when
    const messages = await readSessionMessages(sessionID)

    // #then
    expect(messages.length).toBe(2)
    expect(messages[0].id).toBe("msg_001")
    expect(messages[1].id).toBe("msg_002")
  })

  test("readSessionTodos returns empty array when no todos exist", async () => {
    // #when
    const todos = await readSessionTodos("ses_nonexistent")

    // #then
    expect(todos).toEqual([])
  })

  test("getSessionInfo returns null for non-existent session", async () => {
    // #when
    const info = await getSessionInfo("ses_nonexistent")

    // #then
    expect(info).toBeNull()
  })

  test("getSessionInfo aggregates session metadata correctly", async () => {
    // #given
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    const now = Date.now()
    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "user",
        agent: "build",
        time: { created: now - 10000 },
      })
    )
    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({
        id: "msg_002",
        role: "assistant",
        agent: "oracle",
        time: { created: now },
      })
    )

    // #when
    const info = await getSessionInfo(sessionID)

    // #then
    expect(info).not.toBeNull()
    expect(info?.id).toBe(sessionID)
    expect(info?.message_count).toBe(2)
    expect(info?.agents_used).toContain("build")
    expect(info?.agents_used).toContain("oracle")
  })
})
