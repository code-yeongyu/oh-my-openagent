/// <reference types="bun-types" />
import { describe, expect, test, afterEach } from "bun:test"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

import { persistLoopState, loadLoopState, clearLoopState } from "./loop-state-persistence"

describe("loop-state-persistence", () => {
  const testDir = join(tmpdir(), `omo-loop-state-test-${Date.now()}`)

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true })
    } catch {
    }
  })

  test("given no persisted state, loadLoopState returns null", () => {
    const result = loadLoopState(testDir, "test-session")
    expect(result).toBeNull()
  })

  test("given persisted state, loadLoopState returns the correct values", () => {
    persistLoopState(testDir, "test-session", {
      consecutiveClarifications: 2,
      consecutiveFailures: 1,
      stagnationCount: 3,
    })

    const result = loadLoopState(testDir, "test-session")
    expect(result).not.toBeNull()
    expect(result!.consecutiveClarifications).toBe(2)
    expect(result!.consecutiveFailures).toBe(1)
    expect(result!.stagnationCount).toBe(3)
    expect(result!.sessionID).toBe("test-session")
  })

  test("given overwritten state, loadLoopState returns updated values", () => {
    persistLoopState(testDir, "test-session", {
      consecutiveClarifications: 1,
      consecutiveFailures: 0,
      stagnationCount: 0,
    })

    persistLoopState(testDir, "test-session", {
      consecutiveClarifications: 3,
      consecutiveFailures: 5,
      stagnationCount: 2,
    })

    const result = loadLoopState(testDir, "test-session")
    expect(result!.consecutiveClarifications).toBe(3)
    expect(result!.consecutiveFailures).toBe(5)
    expect(result!.stagnationCount).toBe(2)
  })

  test("given cleared state, loadLoopState returns null", () => {
    persistLoopState(testDir, "test-session", {
      consecutiveClarifications: 1,
      consecutiveFailures: 0,
      stagnationCount: 0,
    })

    clearLoopState(testDir, "test-session")
    expect(loadLoopState(testDir, "test-session")).toBeNull()
  })

  test("given corrupted file, loadLoopState returns null", () => {
    const statePath = join(testDir, ".sisyphus", "loop-state", "test-session.json")
    mkdirSync(join(testDir, ".sisyphus", "loop-state"), { recursive: true })
    writeFileSync(statePath, "not valid json", "utf-8")

    expect(loadLoopState(testDir, "test-session")).toBeNull()
  })

  test("given multiple sessions, each has independent state", () => {
    persistLoopState(testDir, "session-a", {
      consecutiveClarifications: 2,
      consecutiveFailures: 0,
      stagnationCount: 0,
    })
    persistLoopState(testDir, "session-b", {
      consecutiveClarifications: 0,
      consecutiveFailures: 3,
      stagnationCount: 1,
    })

    expect(loadLoopState(testDir, "session-a")!.consecutiveClarifications).toBe(2)
    expect(loadLoopState(testDir, "session-a")!.consecutiveFailures).toBe(0)

    expect(loadLoopState(testDir, "session-b")!.consecutiveClarifications).toBe(0)
    expect(loadLoopState(testDir, "session-b")!.consecutiveFailures).toBe(3)
  })
})
