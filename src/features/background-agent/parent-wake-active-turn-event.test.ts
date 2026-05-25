import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"

type PromptAsyncCall = {
  path: { id: string }
  body: {
    noReply?: boolean
    parts?: unknown[]
  }
  query?: {
    directory: string
  }
}

type PendingParentWakeForTest = {
  notifications: string[]
  shouldReply: boolean
}

let managerUnderTest: BackgroundManager | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  releaseAllPromptAsyncReservationsForTesting()
  managerUnderTest = undefined
})

function createTask(overrides: Partial<BackgroundTask> & { id: string; parentSessionId: string }): BackgroundTask {
  const id = overrides.id
  const parentSessionID = overrides.parentSessionId
  const { id: _ignoredID, parentSessionId: _ignoredParentSessionID, ...rest } = overrides

  return {
    parentMessageId: overrides.parentMessageId ?? "parent-message-id",
    description: overrides.description ?? overrides.id,
    prompt: overrides.prompt ?? `Prompt for ${overrides.id}`,
    agent: overrides.agent ?? "test-agent",
    status: overrides.status ?? "running",
    startedAt: overrides.startedAt ?? new Date("2026-05-20T14:19:10.000Z"),
    ...rest,
    id,
    parentSessionId: parentSessionID,
  }
}

function createManager(sessionStatuses: Record<string, { type: string }>): {
  manager: BackgroundManager
  promptAsyncCalls: PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = {
    session: {
      messages: async () => [],
      status: async () => ({ data: sessionStatuses }),
      prompt: async () => ({}),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return {}
      },
      abort: async () => ({}),
    },
  }
  const ctx: PluginInput = {
    client: client as PluginInput["client"],
    project: {} as PluginInput["project"],
    directory: tmpdir(),
    worktree: tmpdir(),
    serverUrl: new URL("http://localhost"),
    $: {} as PluginInput["$"],
  }

  const manager = new BackgroundManager({
    pluginContext: ctx,
    config: undefined,
    enableParentSessionNotifications: true,
  })

  return { manager, promptAsyncCalls }
}

function getTasks(manager: BackgroundManager): Map<string, BackgroundTask> {
  return Reflect.get(manager, "tasks") as Map<string, BackgroundTask>
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return Reflect.get(manager, "pendingByParent") as Map<string, Set<string>>
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, PendingParentWakeForTest> {
  const parentWakeNotifier = Reflect.get(manager, "parentWakeNotifier") as {
    getPendingParentWakes: () => Map<string, PendingParentWakeForTest>
  }
  return parentWakeNotifier.getPendingParentWakes()
}

async function notifyParentSessionForTest(manager: BackgroundManager, task: BackgroundTask): Promise<void> {
  const notifyParentSession = Reflect.get(manager, "notifyParentSession") as (task: BackgroundTask) => Promise<void>
  return notifyParentSession.call(manager, task)
}

async function flushPendingParentWakeForTest(manager: BackgroundManager, sessionID: string): Promise<void> {
  const flushPendingParentWake = Reflect.get(manager, "flushPendingParentWake") as (sessionID: string) => Promise<void>
  return flushPendingParentWake.call(manager, sessionID)
}

describe("BackgroundManager parent wake active turn events", () => {
  test("#when parent reasoning delta is newer than stale idle state #then background completion does not fork a reply", async () => {
    // given
    const sessionStatuses: Record<string, { type: string }> = {
      "parent-1": { type: "idle" },
    }
    const { manager, promptAsyncCalls } = createManager(sessionStatuses)
    managerUnderTest = manager
    manager.handleEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "parent-1",
        field: "reasoning",
        delta: "still thinking",
      },
    })
    const task = createTask({
      id: "task-a",
      parentSessionId: "parent-1",
      description: "task A",
      status: "completed",
      completedAt: new Date("2026-05-20T14:19:14.625Z"),
    })
    getTasks(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    await notifyParentSessionForTest(manager, task)
    await flushPendingParentWakeForTest(manager, "parent-1")

    // then
    expect(promptAsyncCalls).toHaveLength(0)
    expect(getPendingParentWakes(manager).has("parent-1")).toBe(true)
  })

  test("#when parent idle event follows fresh reasoning delta #then background completion still does not fork a reply", async () => {
    // given
    const sessionStatuses: Record<string, { type: string }> = {
      "parent-1": { type: "idle" },
    }
    const { manager, promptAsyncCalls } = createManager(sessionStatuses)
    managerUnderTest = manager
    manager.handleEvent({
      type: "message.part.delta",
      properties: {
        sessionID: "parent-1",
        field: "reasoning",
        delta: "still thinking",
      },
    })
    const task = createTask({
      id: "task-a",
      parentSessionId: "parent-1",
      description: "task A",
      status: "completed",
      completedAt: new Date("2026-05-20T14:19:14.625Z"),
    })
    getTasks(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    // when
    await notifyParentSessionForTest(manager, task)
    manager.handleEvent({ type: "session.idle", properties: { sessionID: "parent-1" } })
    await flushPendingParentWakeForTest(manager, "parent-1")

    // then
    expect(promptAsyncCalls).toHaveLength(0)
    expect(getPendingParentWakes(manager).has("parent-1")).toBe(true)
  })
})
