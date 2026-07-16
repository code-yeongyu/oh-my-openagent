/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import type { ToolContext } from "@opencode-ai/plugin/tool"
import { BackgroundManager } from "../../features/background-agent"
import type { LaunchInput } from "../../features/background-agent/types"
import { getSessionAgent, subagentSessions } from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createWaitForBackgroundTasks } from "./create-wait-for-background-tasks"

const PARENT_SESSION_ID = "parent-session"

function createToolContext(): ToolContext {
  return {
    sessionID: PARENT_SESSION_ID,
    messageID: "parent-message",
    agent: "sisyphus",
    directory: tmpdir(),
    worktree: tmpdir(),
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

function createManager(client: unknown): BackgroundManager {
  const manager = new BackgroundManager({
    pluginContext: unsafeTestValue<PluginInput>({ client, directory: tmpdir() }),
  })
  Reflect.set(manager, "notifyParentSession", async () => {})
  return manager
}

function getRootDescendantCount(manager: BackgroundManager): number {
  return Reflect.get(manager, "rootDescendantCounts").get(PARENT_SESSION_ID) ?? 0
}

async function runWaiter(manager: BackgroundManager): Promise<string> {
  const waiter = createWaitForBackgroundTasks(manager, {
    pollIntervalMs: 1,
    minimumTimeoutMs: 100,
  })
  const result = await waiter.execute?.({ timeout: 500 }, createToolContext())
  return String(result)
}

async function expectWaitsForRelease(
  waiter: Promise<string>,
  releaseAbort: () => void,
  expectedStatus: "ERROR" | "INTERRUPT",
): Promise<void> {
  const beforeRelease = await Promise.race([
    waiter.then(() => "RETURNED"),
    new Promise<string>((resolve) => setTimeout(() => resolve("WAITING"), 20)),
  ])
  expect(beforeRelease).toBe("WAITING")

  releaseAbort()
  expect(await waiter).toContain(`**${expectedStatus}**`)
}

function createLaunchInput(overrides: Partial<LaunchInput> = {}): LaunchInput {
  return {
    description: "launch failure cleanup",
    prompt: "test prompt",
    agent: "sisyphus-junior",
    parentSessionId: PARENT_SESSION_ID,
    parentMessageId: "parent-message",
    ...overrides,
  }
}

describe("wait-for-background-tasks launch failure finalization", () => {
  test("waits for child abort after the launch prompt rejects", async () => {
    // #given a launch prompt rejection whose child-session abort remains blocked
    let signalAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => { signalAbortStarted = resolve })
    let releaseAbort: (() => void) | undefined
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve })
    const manager = createManager({
      session: {
        get: async () => ({ data: { directory: tmpdir() } }),
        create: async () => ({ data: { id: "child-prompt-rejection" } }),
        promptAsync: async () => { throw new Error("launch rejected") },
        abort: async () => {
          signalAbortStarted?.()
          await abortGate
          return {}
        },
      },
    })

    try {
      // #when the prompt failure becomes terminal before teardown finishes
      await manager.launch(createLaunchInput())
      const waiter = runWaiter(manager)
      await abortStarted

      // #then the waiter remains blocked until the child abort settles
      await expectWaitsForRelease(waiter, () => releaseAbort?.(), "INTERRUPT")
    } finally {
      releaseAbort?.()
      await manager.shutdown()
    }
  })

  test("waits for orphan-session abort after startTask throws", async () => {
    // #given a startTask failure after the child session has been bound
    let signalAbortStarted: (() => void) | undefined
    const abortStarted = new Promise<void>((resolve) => { signalAbortStarted = resolve })
    let releaseAbort: (() => void) | undefined
    const abortGate = new Promise<void>((resolve) => { releaseAbort = resolve })
    const manager = createManager({
      session: {
        get: async () => ({ data: { directory: tmpdir() } }),
        create: async () => ({ data: { id: "child-start-failure" } }),
        promptAsync: async () => ({}),
        abort: async () => {
          signalAbortStarted?.()
          await abortGate
          return {}
        },
      },
    })
    const userPermission = new Proxy({}, {
      ownKeys: () => { throw new Error("startTask failed after session binding") },
    })

    try {
      // #when startTask marks the task terminal and begins orphan cleanup
      await manager.launch(createLaunchInput({ userPermission }))
      const waiter = runWaiter(manager)
      await abortStarted

      // #then the waiter remains blocked until the orphan abort settles
      await expectWaitsForRelease(waiter, () => releaseAbort?.(), "ERROR")
      expect(subagentSessions.has("child-start-failure")).toBe(false)
      expect(getSessionAgent("child-start-failure")).toBeUndefined()
      expect(getRootDescendantCount(manager)).toBe(0)
    } finally {
      releaseAbort?.()
      await manager.shutdown()
    }
  })
})
