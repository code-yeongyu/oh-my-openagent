import { tmpdir } from "node:os"
import { afterEach, describe, expect, test } from "bun:test"
import type { PluginInput } from "@opencode-ai/plugin"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { BackgroundManager } from "./manager"
import type { BackgroundTask } from "./types"

type PromptAsyncCall = {
  readonly path: { readonly id: string }
  readonly body: { readonly parts?: readonly unknown[] }
}

let managerUnderTest: BackgroundManager | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  managerUnderTest = undefined
  releaseAllPromptAsyncReservationsForTesting()
})

function createTask(): BackgroundTask {
  return {
    id: "task-a",
    parentMessageId: "parent-message-id",
    parentSessionId: "parent-1",
    description: "task A",
    prompt: "Prompt for task A",
    agent: "test-agent",
    status: "completed",
    startedAt: new Date("2026-05-20T14:19:10.000Z"),
    completedAt: new Date("2026-05-20T14:19:14.625Z"),
  }
}

function createManager(): {
  readonly manager: BackgroundManager
  readonly promptAsyncCalls: readonly PromptAsyncCall[]
} {
  const promptAsyncCalls: PromptAsyncCall[] = []
  const client = unsafeTestValue<PluginInput["client"]>({
    session: {
      messages: async () => [],
      status: async () => ({ data: { "parent-1": { type: "idle" } } }),
      prompt: async () => ({}),
      promptAsync: async (call: PromptAsyncCall) => {
        promptAsyncCalls.push(call)
        return {}
      },
      abort: async () => ({}),
    },
  })
  const manager = new BackgroundManager({
    pluginContext: {
      client,
      project: {},
      directory: tmpdir(),
      worktree: tmpdir(),
      serverUrl: new URL("http://localhost"),
      $: {},
    },
    config: undefined,
    enableParentSessionNotifications: true,
  })
  return { manager, promptAsyncCalls }
}

function getTasks(manager: BackgroundManager): Map<string, BackgroundTask> {
  return unsafeTestValue<Map<string, BackgroundTask>>(Reflect.get(manager, "tasks"))
}

function getPendingByParent(manager: BackgroundManager): Map<string, Set<string>> {
  return unsafeTestValue<Map<string, Set<string>>>(Reflect.get(manager, "pendingByParent"))
}

function getPendingParentWakes(manager: BackgroundManager): Map<string, unknown> {
  const notifier = unsafeTestValue<{
    readonly getPendingParentWakes: () => Map<string, unknown>
  }>(Reflect.get(manager, "parentWakeNotifier"))
  return notifier.getPendingParentWakes()
}

async function notifyParentSessionForTest(manager: BackgroundManager, task: BackgroundTask): Promise<void> {
  const notifyParentSession = unsafeTestValue<(task: BackgroundTask) => Promise<void>>(Reflect.get(manager, "notifyParentSession"))
  await notifyParentSession.call(manager, task)
}

async function flushPendingParentWakeForTest(manager: BackgroundManager, sessionID: string): Promise<void> {
  const flushPendingParentWake = unsafeTestValue<(sessionID: string) => Promise<void>>(Reflect.get(manager, "flushPendingParentWake"))
  await flushPendingParentWake.call(manager, sessionID)
}

describe("BackgroundManager parent wake activity window", () => {
  test("#given parent tool activity is within the tool deferral window #when stale idle flushes a wake #then wake is recorded without forking a reply", async () => {
    // given
    const originalDateNow = Date.now
    let now = 100_000
    Date.now = () => now
    const { manager, promptAsyncCalls } = createManager()
    managerUnderTest = manager
    manager.handleEvent({
      type: "message.part.updated",
      properties: {
        sessionID: "parent-1",
        part: {
          sessionID: "parent-1",
          type: "tool",
          tool: "todowrite",
        },
      },
    })
    now = 104_900
    const task = createTask()
    getTasks(manager).set(task.id, task)
    getPendingByParent(manager).set(task.parentSessionId, new Set([task.id]))

    try {
      // when
      await notifyParentSessionForTest(manager, task)
      await flushPendingParentWakeForTest(manager, "parent-1")

      // then
      expect(promptAsyncCalls).toHaveLength(1)
      expect(promptAsyncCalls[0]?.body.noReply).toBe(true)
      expect(getPendingParentWakes(manager).has("parent-1")).toBe(true)
    } finally {
      Date.now = originalDateNow
    }
  })
})
