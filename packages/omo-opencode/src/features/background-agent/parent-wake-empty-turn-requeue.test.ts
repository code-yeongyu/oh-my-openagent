import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "node:os"
import type { PluginInput } from "@opencode-ai/plugin"
import { releaseAllPromptAsyncReservationsForTesting } from "../../hooks/shared/prompt-async-gate"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { isEmptyNoProgressAssistantTurnInfo } from "./empty-assistant-turn"
import { BackgroundManager } from "./manager"

type PromptCall = {
  readonly path: { readonly id: string }
  readonly body: Record<string, unknown>
}

type PendingParentWakeForTest = {
  readonly notifications: string[]
}

type ParentWakeInternals = {
  readonly getPendingParentWakes: () => Map<string, PendingParentWakeForTest>
  readonly getDispatchedParentWakes: () => Map<string, PendingParentWakeForTest>
}

type BackgroundManagerInternals = {
  readonly parentWakeNotifier: ParentWakeInternals
  readonly queuePendingParentWake: (
    sessionID: string,
    notification: string,
    promptContext: Record<string, unknown>,
    shouldReply: boolean,
    delayMs?: number,
  ) => void
  readonly flushPendingParentWake: (sessionID: string) => Promise<void>
}

type SessionMessageForTest = {
  readonly info: Record<string, unknown>
  readonly parts?: readonly Record<string, unknown>[]
}

const EMPTY_UNKNOWN_ASSISTANT_INFO = {
  id: "msg-empty",
  sessionID: "parent-session-empty-wake",
  role: "assistant",
  finish: "unknown",
  tokens: {
    input: 0,
    output: 0,
    reasoning: 0,
    cache: { write: 0, read: 0 },
  },
} as const

let managerUnderTest: BackgroundManager | undefined

afterEach(() => {
  managerUnderTest?.shutdown()
  managerUnderTest = undefined
  releaseAllPromptAsyncReservationsForTesting()
})

function createManager(sessionMessages: readonly SessionMessageForTest[] = []): {
  readonly manager: BackgroundManager
  readonly internals: BackgroundManagerInternals
  readonly promptCalls: PromptCall[]
} {
  const promptCalls: PromptCall[] = []
  const client = unsafeTestValue<PluginInput["client"]>({
    session: {
      status: async () => ({ data: { "parent-session-empty-wake": { type: "idle" } } }),
      messages: async () => ({ data: sessionMessages }),
      promptAsync: async (args: PromptCall) => {
        promptCalls.push(args)
        return {}
      },
      abort: async () => ({}),
    },
  })
  const pluginContext = unsafeTestValue<PluginInput>({
    client,
    directory: tmpdir(),
  })
  const manager = new BackgroundManager({ pluginContext })
  return {
    manager,
    internals: unsafeTestValue<BackgroundManagerInternals>(manager),
    promptCalls,
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) {
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  expect(predicate()).toBe(true)
}

function waitForPendingWake(internals: BackgroundManagerInternals, sessionID: string): Promise<void> {
  return waitUntil(() => internals.parentWakeNotifier.getPendingParentWakes().has(sessionID), 600)
}

describe("isEmptyNoProgressAssistantTurnInfo", () => {
  test("#given zero-token unknown assistant info #when classified #then it is treated as empty no-progress", () => {
    // given
    const info = EMPTY_UNKNOWN_ASSISTANT_INFO

    // when
    const result = isEmptyNoProgressAssistantTurnInfo(info)

    // then
    expect(result).toBe(true)
  })

  test("#given non-empty or non-assistant message updates #when classified #then they are not treated as empty no-progress", () => {
    // given
    const falseCases: readonly unknown[] = [
      { ...EMPTY_UNKNOWN_ASSISTANT_INFO, tokens: { ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens, input: 1 } },
      { ...EMPTY_UNKNOWN_ASSISTANT_INFO, tokens: { ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens, output: 1 } },
      {
        ...EMPTY_UNKNOWN_ASSISTANT_INFO,
        tokens: {
          ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens,
          cache: { ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens.cache, read: 1 },
        },
      },
      {
        ...EMPTY_UNKNOWN_ASSISTANT_INFO,
        tokens: {
          ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens,
          cache: { ...EMPTY_UNKNOWN_ASSISTANT_INFO.tokens.cache, write: 1 },
        },
      },
      { ...EMPTY_UNKNOWN_ASSISTANT_INFO, finish: "stop" },
      { ...EMPTY_UNKNOWN_ASSISTANT_INFO, role: "user" },
      { role: "assistant", finish: "unknown" },
      undefined,
    ]

    // when
    const results = falseCases.map(isEmptyNoProgressAssistantTurnInfo)

    // then
    expect(results).toEqual(falseCases.map(() => false))
  })

  test("#given zero-token unknown assistant info without cache counts #when classified #then it is still treated as empty no-progress", () => {
    // given
    const info = {
      id: "msg-empty-no-cache",
      sessionID: "parent-session-empty-wake",
      role: "assistant",
      finish: "unknown",
      tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
      },
    } as const

    // when
    const result = isEmptyNoProgressAssistantTurnInfo(info)

    // then
    expect(result).toBe(true)
  })
})

describe("BackgroundManager parent wake empty-turn recovery", () => {
  test("#given dispatched parent wake #when OpenCode records a zero-token empty unknown assistant turn #then the wake is requeued", async () => {
    // given
    const { manager, internals, promptCalls } = createManager()
    managerUnderTest = manager
    const sessionID = "parent-session-empty-wake"
    const notification = "<system-reminder>done</system-reminder>"
    internals.queuePendingParentWake(sessionID, notification, { agent: "sisyphus" }, true, 0)
    await internals.flushPendingParentWake(sessionID)
    expect(promptCalls).toHaveLength(1)
    expect(internals.parentWakeNotifier.getDispatchedParentWakes().has(sessionID)).toBe(true)

    // when
    manager.handleEvent({
      type: "message.updated",
      properties: {
        sessionID,
        info: EMPTY_UNKNOWN_ASSISTANT_INFO,
      },
    })
    await waitForPendingWake(internals, sessionID)

    // then
    expect(internals.parentWakeNotifier.getDispatchedParentWakes().has(sessionID)).toBe(false)
    expect(internals.parentWakeNotifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([
      notification,
    ])
  })

  test("#given dispatched parent wake has coalesced notifications #when OpenCode records an empty assistant turn #then notification slots are preserved", async () => {
    // given
    const { manager, internals, promptCalls } = createManager()
    managerUnderTest = manager
    const sessionID = "parent-session-empty-wake"
    const firstNotification = "<system-reminder>first</system-reminder>"
    const secondNotification = "<system-reminder>second</system-reminder>"
    internals.queuePendingParentWake(sessionID, firstNotification, { agent: "sisyphus" }, true, 0)
    internals.queuePendingParentWake(sessionID, secondNotification, { agent: "sisyphus" }, true, 0)
    await internals.flushPendingParentWake(sessionID)
    expect(promptCalls).toHaveLength(1)
    expect(internals.parentWakeNotifier.getDispatchedParentWakes().get(sessionID)?.notifications).toEqual([
      firstNotification,
      secondNotification,
    ])

    // when
    manager.handleEvent({
      type: "message.updated",
      properties: {
        sessionID,
        info: EMPTY_UNKNOWN_ASSISTANT_INFO,
      },
    })
    await waitForPendingWake(internals, sessionID)

    // then
    expect(internals.parentWakeNotifier.getPendingParentWakes().get(sessionID)?.notifications).toEqual([
      firstNotification,
      secondNotification,
    ])
  })

  test("#given parent history contains the empty assistant turn #when idle flushes the requeued wake #then one retry prompt is delivered", async () => {
    // given
    const sessionID = "parent-session-empty-wake"
    const notification = "<system-reminder>done</system-reminder>"
    const sessionMessages: SessionMessageForTest[] = []
    const completedEmptyHistory: readonly SessionMessageForTest[] = [
      {
        info: { role: "user", time: { created: 1000 } },
        parts: [{ type: "text", text: notification }],
      },
      {
        info: {
          ...EMPTY_UNKNOWN_ASSISTANT_INFO,
          time: { created: 2000, completed: 3000 },
        },
        parts: [{ type: "step-finish", reason: "unknown", tokens: EMPTY_UNKNOWN_ASSISTANT_INFO.tokens }],
      },
    ]
    const { manager, internals, promptCalls } = createManager(sessionMessages)
    managerUnderTest = manager
    internals.queuePendingParentWake(sessionID, notification, { agent: "sisyphus" }, true, 0)
    await internals.flushPendingParentWake(sessionID)
    expect(promptCalls).toHaveLength(1)
    sessionMessages.push(...completedEmptyHistory)

    manager.handleEvent({
      type: "message.updated",
      properties: {
        sessionID,
        info: EMPTY_UNKNOWN_ASSISTANT_INFO,
      },
    })
    await waitForPendingWake(internals, sessionID)

    // when
    manager.handleEvent({ type: "session.idle", properties: { sessionID } })
    await internals.flushPendingParentWake(sessionID)
    await waitUntil(() => promptCalls.length === 2, 4_000)

    // then
    expect(promptCalls).toHaveLength(2)
    expect(JSON.stringify(promptCalls[1]?.body.parts)).toContain(notification)
  })
})
