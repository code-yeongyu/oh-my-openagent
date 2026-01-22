/**
 * Session Catchup Analyzer Tests
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test"
import { mkdirSync, writeFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { analyzeSessionCatchup } from "./analyzer"

describe("session-catchup", () => {
  const TEST_DIR = join(tmpdir(), "session-catchup-test-" + Date.now())
  const CHANGES_DIR = join(TEST_DIR, "changes", "test-change")

  beforeEach(() => {
    mkdirSync(CHANGES_DIR, { recursive: true })
  })

  afterEach(() => {
    try {
      rmSync(TEST_DIR, { recursive: true, force: true })
    } catch {
      // Ignore cleanup errors
    }
  })

  // #given no plan path provided
  // #when analyzeSessionCatchup is called
  // #then it should return null
  it("returns null when no plan path provided", () => {
    const result = analyzeSessionCatchup(TEST_DIR, null)
    expect(result).toBeNull()
  })

  // #given planning files don't exist
  // #when analyzeSessionCatchup is called
  // #then it should return empty report
  it("returns empty report when planning files don't exist", () => {
    const result = analyzeSessionCatchup(TEST_DIR, "changes/test-change/tasks.md")
    expect(result).not.toBeNull()
    expect(result?.hasUnsyncedMessages).toBe(false)
    expect(result?.unsyncedCount).toBe(0)
    expect(result?.lastPlanningUpdate).toBeNull()
  })

  // #given planning file exists
  // #when analyzeSessionCatchup is called with valid path
  // #then it should return report with lastPlanningUpdate set
  it("detects planning file mtime", () => {
    const tasksPath = join(CHANGES_DIR, "tasks.md")
    writeFileSync(tasksPath, "# Tasks\n- [ ] Test task")
    
    const result = analyzeSessionCatchup(TEST_DIR, "changes/test-change/tasks.md")
    expect(result).not.toBeNull()
    expect(result?.lastPlanningUpdate).not.toBeNull()
    expect(result?.planningFilePath).toBe(tasksPath)
  })
})
