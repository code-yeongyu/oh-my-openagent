/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  _resetRuntimeFallbackRecoveryForTesting,
  openRuntimeFallbackRecoveryClaim,
  registerRuntimeFallbackRecoveryOwner,
  settleRuntimeFallbackRecoveryClaim,
} from "../../shared/runtime-fallback-recovery"
import { BackgroundManager } from "./manager"
import { clearBackgroundTaskRegistryForTesting } from "./task-registry"
import type { BackgroundTask } from "./types"

type SessionMessage = { info: { role: string; error?: unknown }; parts: Array<{ type: string; text?: string }> }
type SessionErrorEvent = { type: string; properties: { sessionID: string; error: { name: string; message: string } } }

const SESSION_ID = "ses_recovery"
const CONCURRENCY_KEY = "explore/anthropic"
const ORIGINAL_ERROR = { name: "ProviderUnavailableError", message: "no provider available" }
const RETRY_ERROR = { name: "ProviderUnavailableError", message: "no provider available for the retry generation" }

const ERRORED_TURN: SessionMessage[] = [
  { info: { role: "user" }, parts: [{ type: "text", text: "do the work" }] },
  { info: { role: "assistant", error: { name: "ProviderModelNotFoundError" } }, parts: [] },
]

function createPluginContext(client: object): PluginInput {
  const directory = tmpdir()
  return {
    project: { id: "test-project", worktree: directory, time: { created: Date.now() } },
    directory,
    worktree: directory,
    serverUrl: new URL("http://localhost:4096"),
    $: {} as PluginInput["$"],
    client: client as PluginInput["client"],
  }
}

function createHarness() {
  const state: { status: string; messages: SessionMessage[] } = { status: "busy", messages: ERRORED_TURN }
  const replacementCalls: string[] = []
  const client = {
    session: {
      status: async () => ({ data: { [SESSION_ID]: { type: state.status } } }),
      get: async () => ({ data: { id: SESSION_ID } }),
      create: async () => {
        replacementCalls.push("create")
        return { data: { id: "ses_replacement" } }
      },
      prompt: async () => ({}),
      promptAsync: async () => {
        replacementCalls.push("promptAsync")
        return {}
      },
      abort: async () => ({}),
      todo: async () => ({ data: [] }),
      messages: async () => ({ data: state.messages }),
    },
  }
  const manager = new BackgroundManager({
    pluginContext: createPluginContext(client),
    config: undefined,
    enableParentSessionNotifications: false,
  })
  const task: BackgroundTask = {
    id: `bg_${SESSION_ID}`,
    sessionId: SESSION_ID,
    parentSessionId: "parent-session",
    parentMessageId: "parent-msg",
    description: "task whose first generation failed",
    prompt: "do the work",
    agent: "explore",
    status: "running",
    startedAt: new Date(),
    progress: { toolCalls: 0, lastUpdate: new Date() },
    concurrencyKey: CONCURRENCY_KEY,
    fallbackChain: [{ providers: ["anthropic"], model: "claude-opus-4-7" }, { providers: ["anthropic"], model: "gpt-5.5" }],
    attemptCount: 0,
  }
  manager["tasks"].set(task.id, task)
  return { manager, task, state, replacementCalls }
}

function sessionError(error: { name: string; message: string }): SessionErrorEvent {
  return { type: "session.error", properties: { sessionID: SESSION_ID, error } }
}

async function flush(): Promise<void> {
  for (let index = 0; index < 5; index++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
}

/** Delivers the event the way the dispatcher does: the claim is open before the manager sees it. */
function deliver(manager: BackgroundManager, event: SessionErrorEvent): void {
  openRuntimeFallbackRecoveryClaim(event, SESSION_ID)
  manager.handleEvent(event)
}

describe("BackgroundManager session.error arbitration with runtime-fallback", () => {
  beforeEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
    registerRuntimeFallbackRecoveryOwner()
  })

  afterEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
    clearBackgroundTaskRegistryForTesting()
  })

  test("#given a retry accepted by runtime-fallback #when the original error is handled #then the task keeps running and keeps its slot", async () => {
    // given
    const { manager, task, replacementCalls } = createHarness()
    await manager["concurrencyManager"].acquire(CONCURRENCY_KEY)
    task.consecutiveErroredIdlePolls = 7
    const event = sessionError(ORIGINAL_ERROR)

    // when
    deliver(manager, event)
    await flush()
    const runningWhileDecisionPending = task.status
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
    await flush()
    const slotsHeld = manager["concurrencyManager"].getCount(CONCURRENCY_KEY)
    const keyHeld = task.concurrencyKey
    await manager.shutdown()

    // then
    expect(runningWhileDecisionPending).toBe("running")
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
    expect(task.completedAt).toBeUndefined()
    expect(keyHeld).toBe(CONCURRENCY_KEY)
    expect(slotsHeld).toBe(1)
    expect(task.consecutiveErroredIdlePolls).toBe(0)
    expect(manager["notifications"].get(task.parentSessionId)).toBeUndefined()
    expect(replacementCalls).toEqual([])
  })

  test("#given runtime-fallback owns recovery #when the manager has its own fallback chain #then no replacement session is started", async () => {
    // given
    const { manager, task } = createHarness()
    const retriedByManager: string[] = []
    manager["tryFallbackRetry"] = async () => {
      retriedByManager.push(task.id)
      return true
    }
    const event = sessionError({ name: "APIError", message: "Rate limit reached for requests" })

    // when
    deliver(manager, event)
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
    await flush()
    await manager.shutdown()

    // then
    expect(retriedByManager).toEqual([])
    expect(task.status).toBe("running")
  })

  test("#given runtime-fallback declines #when the error is handled #then the task ends in error as before", async () => {
    // given
    const { manager, task } = createHarness()
    await manager["concurrencyManager"].acquire(CONCURRENCY_KEY)
    const event = sessionError(ORIGINAL_ERROR)

    // when
    deliver(manager, event)
    await flush()
    const statusWhileDecisionPending = task.status
    settleRuntimeFallbackRecoveryClaim(event, "declined")
    await flush()
    const slotsHeld = manager["concurrencyManager"].getCount(CONCURRENCY_KEY)
    await manager.shutdown()

    // then
    expect(statusWhileDecisionPending).toBe("running")
    expect(task.status).toBe("error")
    expect(task.error).toContain("no provider available")
    expect(task.concurrencyKey).toBeUndefined()
    expect(slotsHeld).toBe(0)
  })

  test("#given no claim was opened for the error #when it is handled #then the task ends in error without waiting", async () => {
    // given
    const { manager, task } = createHarness()
    const event = sessionError(ORIGINAL_ERROR)

    // when
    manager.handleEvent(event)
    await flush()
    await manager.shutdown()

    // then
    expect(task.status).toBe("error")
    expect(task.error).toContain("no provider available")
  })

  test("#given an accepted retry #when its generation completes #then the task completes with the retry's output", async () => {
    // given
    const { manager, task, state } = createHarness()
    const event = sessionError(ORIGINAL_ERROR)
    deliver(manager, event)
    settleRuntimeFallbackRecoveryClaim(event, "retry-owned")
    await flush()
    await manager["pollRunningTasks"]()
    const statusWhileRetryRuns = task.status

    // when
    state.status = "idle"
    state.messages = [
      ...ERRORED_TURN,
      { info: { role: "assistant" }, parts: [{ type: "text", text: "finished on the fallback model" }] },
    ]
    await manager["pollRunningTasks"]()
    await manager.shutdown()

    // then
    expect(statusWhileRetryRuns).toBe("running")
    expect(task.status).toBe("completed")
    expect(task.error).toBeUndefined()
  })

  test("#given an accepted retry #when the retry generation fails and runtime-fallback declines #then the retry's error ends the task", async () => {
    // given
    const { manager, task } = createHarness()
    const originalError = sessionError(ORIGINAL_ERROR)
    deliver(manager, originalError)
    settleRuntimeFallbackRecoveryClaim(originalError, "retry-owned")
    await flush()
    const statusAfterRetryAccepted = task.status
    const retryError = sessionError(RETRY_ERROR)

    // when
    deliver(manager, retryError)
    settleRuntimeFallbackRecoveryClaim(retryError, "declined")
    await flush()
    await manager.shutdown()

    // then
    expect(statusAfterRetryAccepted).toBe("running")
    expect(task.status).toBe("error")
    expect(task.error).toContain("for the retry generation")
  })

  test("#given a stale error from the superseded generation #when the retry is already live #then the stale error cannot end the task", async () => {
    // given
    const { manager, task } = createHarness()
    const staleError = sessionError(ORIGINAL_ERROR)
    const retryError = sessionError(RETRY_ERROR)
    deliver(manager, staleError)
    deliver(manager, retryError)

    // when
    settleRuntimeFallbackRecoveryClaim(retryError, "retry-owned")
    settleRuntimeFallbackRecoveryClaim(staleError, "retry-owned")
    await flush()
    await manager.shutdown()

    // then
    expect(task.status).toBe("running")
    expect(task.error).toBeUndefined()
  })

  test("#given the task is cancelled while the decision is pending #when runtime-fallback declines #then the cancelled task is not finalized as an error", async () => {
    // given
    const { manager, task } = createHarness()
    const event = sessionError(ORIGINAL_ERROR)
    deliver(manager, event)
    await flush()

    // when
    task.status = "cancelled"
    settleRuntimeFallbackRecoveryClaim(event, "declined")
    await flush()
    await manager.shutdown()

    // then
    expect(task.status).toBe("cancelled")
    expect(task.error).toBeUndefined()
  })
})
