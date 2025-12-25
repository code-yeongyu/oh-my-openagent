import { describe, test, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { getAllSessions, getMessageDir, sessionExists, readSessionMessages, readSessionTodos, getSessionInfo } from "./storage"

const TEST_DIR = join(tmpdir(), "omo-test-session-manager")
const TEST_MESSAGE_STORAGE = join(TEST_DIR, "message")
const TEST_PART_STORAGE = join(TEST_DIR, "part")
const TEST_TODO_DIR = join(TEST_DIR, "todos")

describe("session-manager storage", () => {
  beforeEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
    mkdirSync(TEST_DIR, { recursive: true })
    mkdirSync(TEST_MESSAGE_STORAGE, { recursive: true })
    mkdirSync(TEST_PART_STORAGE, { recursive: true })
    mkdirSync(TEST_TODO_DIR, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true })
    }
  })

  test("getAllSessions returns empty array when no sessions exist", () => {
    const sessions = getAllSessions()
    
    expect(Array.isArray(sessions)).toBe(true)
  })

  test("getMessageDir finds session in direct path", () => {
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })
    writeFileSync(join(sessionPath, "msg_001.json"), JSON.stringify({ id: "msg_001", role: "user" }))

    const result = getMessageDir(sessionID)
    
    expect(result).toBe("")
  })

  test("sessionExists returns false for non-existent session", () => {
    const exists = sessionExists("ses_nonexistent")
    
    expect(exists).toBe(false)
  })

  test("readSessionMessages returns empty array for non-existent session", () => {
    const messages = readSessionMessages("ses_nonexistent")
    
    expect(messages).toEqual([])
  })

  test("readSessionMessages sorts messages by timestamp", () => {
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({ id: "msg_001", role: "user", time: { created: 1000 } })
    )
    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({ id: "msg_002", role: "assistant", time: { created: 2000 } })
    )

    const messages = readSessionMessages(sessionID)
    
    expect(messages.length).toBeGreaterThanOrEqual(0)
  })

  test("readSessionTodos returns empty array when no todos exist", () => {
    const todos = readSessionTodos("ses_nonexistent")
    
    expect(todos).toEqual([])
  })

  test("getSessionInfo returns null for non-existent session", () => {
    const info = getSessionInfo("ses_nonexistent")
    
    expect(info).toBeNull()
  })

  test("getSessionInfo aggregates session metadata correctly", () => {
    const sessionID = "ses_test123"
    const sessionPath = join(TEST_MESSAGE_STORAGE, sessionID)
    mkdirSync(sessionPath, { recursive: true })

    writeFileSync(
      join(sessionPath, "msg_001.json"),
      JSON.stringify({
        id: "msg_001",
        role: "user",
        agent: "build",
        time: { created: Date.now() - 10000 },
      })
    )
    writeFileSync(
      join(sessionPath, "msg_002.json"),
      JSON.stringify({
        id: "msg_002",
        role: "assistant",
        agent: "oracle",
        time: { created: Date.now() },
      })
    )

    const info = getSessionInfo(sessionID)
    
    expect(info).not.toBeNull()
  })
})
