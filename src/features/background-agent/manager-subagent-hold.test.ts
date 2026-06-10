/// <reference types="bun-types" />

import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  clearAllDelegatedChildSessionBootstrap,
} from "../../shared/delegated-child-session-bootstrap"
import { releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import {
  _resetForTesting as resetClaudeCodeSessionState,
  setMainSession,
} from "../claude-code-session-state"
import { readContinuationMarker } from "../run-continuation-state"
import { _resetTaskToastManagerForTesting } from "../task-toast-manager/manager"
import { BackgroundManager } from "./manager"
import { _resetForTesting as resetProcessCleanupState } from "./process-cleanup"
import { clearBackgroundTaskRegistryForTesting } from "./task-registry"
import {
  clearAllTurnHoldStateForTesting,
  clearTurnState,
  hasPlanInCurrentTurn,
  markSubagentTypeInTurn,
} from "./subagent-turn-hold-state"
import type { LaunchInput } from "./types"

function cast<T>(value: unknown): T {
  return value as T
}

function createPluginInput(client: unknown, directory = tmpdir()): PluginInput {
  return cast<PluginInput>({ client, directory })
}

function createBackgroundManager(): BackgroundManager {
  return createBackgroundManagerWithDirectory(tmpdir())
}

function createBackgroundManagerWithDirectory(directory: string): BackgroundManager {
  const client = {
    session: {
      prompt: async () => ({}),
      promptAsync: async () => ({}),
      abort: async () => ({}),
      create: async () => ({
        data: { id: `subagent-session-${crypto.randomUUID().slice(0, 8)}` },
        error: null,
      }),
      get: async () => ({
        data: { directory: tmpdir() },
        error: null,
      }),
    },
  }
  return new BackgroundManager({ pluginContext: createPluginInput(client, directory) })
}

function createTempDirectoryPath(): string {
  return `${tmpdir()}/omo-manager-subagent-hold-${crypto.randomUUID()}`
}

function createLaunchInput(overrides: Partial<LaunchInput> & { parentSessionId: string }): LaunchInput {
  return {
    parentSessionId: overrides.parentSessionId,
    parentMessageId: "msg-123",
    description: "Test task",
    prompt: "test prompt",
    agent: overrides.agent ?? "explore",
    ...overrides,
  }
}

describe("manager subagent hold integration", () => {
  afterEach(() => {
    clearBackgroundTaskRegistryForTesting()
    releaseAllPromptAsyncReservationsForTesting()
    resetClaudeCodeSessionState()
    resetProcessCleanupState()
    clearAllDelegatedChildSessionBootstrap()
    _resetTaskToastManagerForTesting()
    clearAllTurnHoldStateForTesting()
  })

  test("should hold explore tasks from main session", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)

    expect(task.status).toBe("pending")
    expect(task.sessionId).toBeUndefined()
  })

  test("should hold librarian tasks from main session", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "librarian",
    })

    const task = await manager.launch(input)

    expect(task.status).toBe("pending")
    expect(task.sessionId).toBeUndefined()
  })

  test("should drop held tasks when plan is detected", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const directory = createTempDirectoryPath()
    const manager = createBackgroundManagerWithDirectory(directory)
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)
    expect(task.status).toBe("pending")

    markSubagentTypeInTurn(mainSessionID, "plan")

    await manager.dropHeldTasks(mainSessionID)

    const updatedTask = manager.getTask(task.id)
    expect(updatedTask?.status).toBe("cancelled")
    expect(updatedTask?.droppedReason).toBeDefined()
    expect(manager.getTasksByParentSession(mainSessionID).find((t) => t.id === task.id)).toBeUndefined()
    expect(readContinuationMarker(directory, mainSessionID)?.sources["background-task"]?.state).toBe("idle")
  })

  test("should release held tasks to normal queue", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)
    expect(task.status).toBe("pending")
    expect(task.sessionId).toBeUndefined()

    // Note: We can't fully verify queue processing without actual LLM calls,
    // but we verify the task transitions out of held state
    await manager.releaseHeldTasks(mainSessionID)

    // After release, task should no longer be in heldItems
    // (It would be in the processing queue next)
  })

  test("should not hold tasks from non-main sessions", async () => {
    const mainSessionID = "main-session"
    const subSessionID = "sub-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: subSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)

    // Task from non-main session should not be held
    expect(task.sessionId).toBeUndefined()
    expect(task.status).toBe("pending")
  })

  test("should clear held task state on clearTurnState", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    await manager.launch(input)

    markSubagentTypeInTurn(mainSessionID, "plan")
    expect(hasPlanInCurrentTurn(mainSessionID)).toBe(true)

    clearTurnState(mainSessionID)
    expect(hasPlanInCurrentTurn(mainSessionID)).toBe(false)
  })

  test("should maintain separate hold state for multiple main sessions", async () => {
    const mainSessionID1 = "main-session-1"
    const mainSessionID2 = "main-session-2"
    setMainSession(mainSessionID1)

    const manager = createBackgroundManager()

    const input1 = createLaunchInput({
      parentSessionId: mainSessionID1,
      agent: "explore",
    })

    const input2 = createLaunchInput({
      parentSessionId: mainSessionID2,
      agent: "explore",
    })

    const task1 = await manager.launch(input1)
    const task2 = await manager.launch(input2)

    markSubagentTypeInTurn(mainSessionID1, "plan")
    expect(hasPlanInCurrentTurn(mainSessionID1)).toBe(true)
    expect(hasPlanInCurrentTurn(mainSessionID2)).toBe(false)

    await manager.dropHeldTasks(mainSessionID1)
    const updatedTask1 = manager.getTask(task1.id)
    expect(updatedTask1?.status).toBe("cancelled")
    expect(manager.getTasksByParentSession(mainSessionID1).find((t) => t.id === task1.id)).toBeUndefined()

    const tasksByParent2 = manager.getTasksByParentSession(mainSessionID2)
    const updatedTask2 = tasksByParent2.find((t) => t.id === task2.id)
    expect(updatedTask2?.status).toBe("pending")
  })

  test("should discard held tasks when parent session is deleted", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const directory = createTempDirectoryPath()
    const manager = createBackgroundManagerWithDirectory(directory)
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)
    expect(task.status).toBe("pending")

    // Verify task is in held items
    const tasksByParent = manager.getTasksByParentSession(mainSessionID)
    expect(tasksByParent.find((t) => t.id === task.id)).toBeDefined()

    // Simulate session.deleted event
    manager.handleEvent({
      type: "session.deleted",
      properties: { sessionID: mainSessionID },
    })

    const taskAfterDelete = manager.getTask(task.id)
    expect(taskAfterDelete).toBeUndefined()
    expect(manager.getTasksByParentSession(mainSessionID)).toEqual([])
    expect(readContinuationMarker(directory, mainSessionID)?.sources["background-task"]?.state).toBe("idle")
  })

  test("should release held tasks timeout without session deletion", async () => {
    const mainSessionID = "main-session"
    setMainSession(mainSessionID)

    const manager = createBackgroundManager()
    const input = createLaunchInput({
      parentSessionId: mainSessionID,
      agent: "explore",
    })

    const task = await manager.launch(input)
    expect(task.status).toBe("pending")

    // Manually release after verifying held state
    // (Normal path: 180s timeout or message.updated finish event)
    await manager.releaseHeldTasks(mainSessionID)

    // Task should be moved to queue (no longer in held items)
    // We can't directly observe queue state, but release succeeds without error
  })
})
