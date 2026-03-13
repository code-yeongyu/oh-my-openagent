import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"

import { _resetForTesting, subagentSessions } from "../claude-code-session-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

function createTask(overrides: Partial<BackgroundTask> & { id: string; sessionID: string }): BackgroundTask {
  return {
    parentSessionID: "parent-session",
    parentMessageID: "parent-message",
    description: "test task",
    prompt: "test prompt",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    ...overrides,
  }
}

function createBackgroundManager(): BackgroundManager {
  return new BackgroundManager({
    client: {
      session: {
        abort: async () => ({}),
        prompt: async () => ({}),
        promptAsync: async () => ({}),
      },
    } as never,
    project: {} as never,
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("https://example.com"),
    $: {} as never,
  } as never)
}

describe("BackgroundManager shutdown global cleanup", () => {
  beforeEach(() => {
    // given
    _resetForTesting()
    SessionCategoryRegistry.clear()
  })

  afterEach(() => {
    // given
    _resetForTesting()
    SessionCategoryRegistry.clear()
  })

  test("removes tracked session IDs from subagentSessions and SessionCategoryRegistry on shutdown", async () => {
    // given
    const runningSessionID = "ses-running-shutdown-cleanup"
    const completedSessionID = "ses-completed-shutdown-cleanup"
    const unrelatedSessionID = "ses-unrelated-shutdown-cleanup"
    const manager = createBackgroundManager()
    const tasks = new Map<string, BackgroundTask>([
      [
        "task-running-shutdown-cleanup",
        createTask({
          id: "task-running-shutdown-cleanup",
          sessionID: runningSessionID,
        }),
      ],
      [
        "task-completed-shutdown-cleanup",
        createTask({
          id: "task-completed-shutdown-cleanup",
          sessionID: completedSessionID,
          status: "completed",
          completedAt: new Date(),
        }),
      ],
    ])

    Object.assign(manager, { tasks })

    subagentSessions.add(runningSessionID)
    subagentSessions.add(completedSessionID)
    subagentSessions.add(unrelatedSessionID)
    SessionCategoryRegistry.register(runningSessionID, "quick")
    SessionCategoryRegistry.register(completedSessionID, "deep")
    SessionCategoryRegistry.register(unrelatedSessionID, "test")

    // when
    await manager.shutdown()

    // then
    expect(subagentSessions.has(runningSessionID)).toBe(false)
    expect(subagentSessions.has(completedSessionID)).toBe(false)
    expect(subagentSessions.has(unrelatedSessionID)).toBe(true)
    expect(SessionCategoryRegistry.has(runningSessionID)).toBe(false)
    expect(SessionCategoryRegistry.has(completedSessionID)).toBe(false)
    expect(SessionCategoryRegistry.has(unrelatedSessionID)).toBe(true)
  })
})
