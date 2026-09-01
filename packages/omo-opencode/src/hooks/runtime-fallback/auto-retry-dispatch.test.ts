import { afterEach, describe, expect, test } from "bun:test"

import { DEFAULT_PROMPT_QUEUE_RETRY_MS, releaseAllPromptAsyncReservationsForTesting } from "../../shared/prompt-async-gate"
import { setPromptReservation } from "@oh-my-opencode/utils/prompt-async-gate/reservations"
import { createAutoRetryHelpers } from "./auto-retry"
import { createFallbackState } from "./fallback-state"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { installRuntimeFallbackTestClock, restoreRuntimeFallbackTestClock } from "./test-timeout-clock.test-support"
import type { HookDeps, RuntimeFallbackPluginInput } from "./types"

function createContext(promptCalls: { count: number }): RuntimeFallbackPluginInput {
  const session = {
    abort: async () => ({}),
    messages: async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
      ],
    }),
    promptAsync: async () => {
      promptCalls.count += 1
      return {}
    },
    status: async () => ({ data: {} }),
  }
  return {
    client: {
      session,
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

function createDeps(promptCalls: { count: number }): HookDeps {
  return {
    ctx: createContext(promptCalls),
    config: {
      enabled: true,
      retry_on_errors: [429, 503, 529],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 0,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    },
    options: undefined,
    pluginConfig: undefined,
    sessionStates: new Map(),
    sessionLastAccess: new Map(),
    sessionRetryInFlight: new Set(),
    sessionAwaitingFallbackResult: new Set(),
    sessionFallbackTimeouts: new Map(),
    sessionStatusRetryKeys: new Map(),
    internallyAbortedSessions: new Set(),
  }
}

function reserveSession(sessionID: string, holdMs: number): void {
  setPromptReservation(sessionID, {
    source: "user-prompt",
    dedupeKey: "stale-cancelled-stream",
    reservedAt: Date.now(),
    token: Symbol("stale-cancelled-stream"),
    expiresAt: Date.now() + holdMs,
  })
}

async function flushPromptGateMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) {
    await Promise.resolve()
  }
}

describe("createAutoRetryDispatcher reserved-session retry (#5109)", () => {
  afterEach(() => {
    releaseAllPromptAsyncReservationsForTesting()
    SessionCategoryRegistry.clear()
    restoreRuntimeFallbackTestClock()
  })

  test("#given a stale promptAsync reservation that releases shortly after #when auto retry runs #then the fallback dispatch is retried instead of silently abandoned", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-reserved-then-released"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    reserveSession(sessionID, 250)
    const clock = installRuntimeFallbackTestClock()

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await flushPromptGateMicrotasks()
    await clock.advanceBy(500)
    await retryPromise

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })

  test("#given the retried dispatch fails ambiguously after the reservation releases #when auto retry runs #then the pending fallback is preserved as possibly accepted", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      throw new Error("JSON Parse error: Unexpected EOF")
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-reserved-then-ambiguous-failure"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    reserveSession(sessionID, 250)
    const clock = installRuntimeFallbackTestClock()

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await flushPromptGateMicrotasks()
    await clock.advanceBy(500)
    await retryPromise

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackPromptMayHaveBeenAccepted).toBe(true)
  })

  test("#given the failed assistant is still active #when auto retry runs #then the fallback dispatch is queued until the assistant unblocks", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-active-assistant-then-unblocked"
    let assistantIsActive = true
    deps.ctx.client.session.messages = async () => ({
      data: assistantIsActive
        ? [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "reasoning", text: "still resolving failed stream" }],
            },
          ]
        : [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
            {
              info: { role: "assistant", finish: true },
              parts: [],
            },
          ],
    })
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    const clock = installRuntimeFallbackTestClock()

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    expect(promptCalls.count).toBe(0)
    assistantIsActive = false
    await flushPromptGateMicrotasks()
    await clock.advanceBy(DEFAULT_PROMPT_QUEUE_RETRY_MS)
    await flushPromptGateMicrotasks()

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4")
  })

  test("#given a session WE internally aborted whose dangling assistant turn has no finish, no output and no terminal error #when auto retry runs #then the fallback dispatch fires immediately instead of looping forever on active-queue", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-internally-aborted-dangling-assistant"
    deps.internallyAbortedSessions.add(sessionID)
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "reasoning", text: "aborted mid-reasoning" }],
        },
      ],
    })
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(1)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(true)
  })

  test("#given a session NOT internally aborted whose assistant turn is genuinely active #when auto retry runs #then the dispatch is still withheld (active-check preserved for live turns)", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-genuinely-active-not-aborted"
    deps.ctx.client.session.messages = async () => ({
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
        {
          info: { role: "assistant" },
          parts: [{ type: "reasoning", text: "genuinely still working" }],
        },
      ],
    })
    const helpers = createAutoRetryHelpers(deps)
    const state = createFallbackState("openai/gpt-5.5")
    state.pendingFallbackModel = "anthropic/claude-opus-4-8"
    deps.sessionStates.set(sessionID, state)

    // when
    await helpers.autoRetryWithFallback(sessionID, "anthropic/claude-opus-4-8", undefined, "session.status")

    // then
    expect(promptCalls.count).toBe(0)
  })

  test("#given an inherited agent variant #when a base fallback is dispatched #then pending state stores the effective variant identity", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          variant: "high",
        },
      },
    }
    const sessionID = "session-inherited-variant"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "openai/gpt-5.4"
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    const helpers = createAutoRetryHelpers(deps)

    // when
    await helpers.autoRetryWithFallback(sessionID, "test-provider/test-model", "sisyphus", "session.status")

    // then
    expect(promptCalls.count).toBe(1)
    expect(state.currentModel).toBe("test-provider/test-model")
    expect(state.pendingFallbackModel).toBe("test-provider/test-model")
  })

  test("#given a category-inherited variant #when a base fallback is dispatched #then pending state stores the effective variant identity", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          category: "visual-engineering",
        },
      },
      categories: {
        "visual-engineering": {
          variant: "high",
        },
      },
    }
    const sessionID = "session-category-inherited-variant"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "openai/gpt-5.4"
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    const helpers = createAutoRetryHelpers(deps)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", "sisyphus", "session.status")

    // then
    expect(promptCalls.count).toBe(1)
    expect(state.currentModel).toBe("openai/gpt-5.4(high)")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4(high)")
  })

  test("#given a registered session category has reasoning #when its fallback is dispatched through another agent #then category reasoning qualifies the prompt and pending identity", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          reasoning: "low",
        },
      },
      categories: {
        deep: {
          reasoning: "high",
        },
      },
    }
    const sessionID = "session-registered-category-reasoning"
    SessionCategoryRegistry.register(sessionID, "deep")
    const state = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, state)
    let capturedBody: Record<string, unknown> | undefined
    deps.ctx.client.session.promptAsync = async (input: unknown) => {
      promptCalls.count += 1
      capturedBody = (input as { body?: Record<string, unknown> }).body
      return {}
    }
    const helpers = createAutoRetryHelpers(deps)

    // when
    await helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", "sisyphus", "session.error")

    // then
    expect(promptCalls.count).toBe(1)
    expect(capturedBody?.variant).toBe("high")
    expect(state.currentModel).toBe("openai/gpt-5.4(high)")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4(high)")
  })

  test("#given an older fallback is awaiting #when a variant-qualified next fallback is accepted as queued #then effective pending state is preserved", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    deps.pluginConfig = {
      agents: {
        sisyphus: {
          category: "visual-engineering",
        },
      },
      categories: {
        "visual-engineering": {
          variant: "high",
        },
      },
    }
    const sessionID = "session-queued-category-variant"
    let assistantIsActive = true
    deps.ctx.client.session.messages = async () => ({
      data: assistantIsActive
        ? [
            {
              info: { role: "assistant" },
              parts: [{ type: "reasoning", text: "still resolving prior fallback" }],
            },
          ]
        : [
            {
              info: { role: "assistant", finish: true },
              parts: [],
            },
          ],
    })
    deps.ctx.client.session.promptAsync = async () => {
      promptCalls.count += 1
      return {}
    }
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.currentModel = "google/gemini-2.5-pro"
    state.pendingFallbackModel = "google/gemini-2.5-pro"
    deps.sessionStates.set(sessionID, state)
    deps.sessionAwaitingFallbackResult.add(sessionID)
    const helpers = createAutoRetryHelpers(deps)
    const clock = installRuntimeFallbackTestClock()

    // when
    const outcome = await helpers.autoRetryWithFallback(
      sessionID,
      "openai/gpt-5.4",
      "sisyphus",
      "session.status",
    )
    assistantIsActive = false
    await flushPromptGateMicrotasks()
    await clock.advanceBy(DEFAULT_PROMPT_QUEUE_RETRY_MS)
    await flushPromptGateMicrotasks()

    // then
    expect(outcome).toEqual({ accepted: true, status: "queued" })
    expect(promptCalls.count).toBe(1)
    expect(state.currentModel).toBe("openai/gpt-5.4(high)")
    expect(state.pendingFallbackModel).toBe("openai/gpt-5.4(high)")
  })

  test("#given manual model change replaces state during a failed dispatch #when rollback runs #then the replacement state is preserved", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    let releaseMessages: (() => void) | undefined
    let messageCallCount = 0
    deps.ctx.client.session.messages = () => {
      messageCallCount += 1
      if (messageCallCount > 1) {
        return Promise.resolve({
          data: [
            {
              info: { role: "assistant" },
              parts: [{ type: "reasoning", text: "still active" }],
            },
          ],
        })
      }
      return new Promise((resolve) => {
        releaseMessages = () => resolve({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
          ],
        })
      })
    }
    const helpers = createAutoRetryHelpers(deps)
    const sessionID = "session-replaced-during-dispatch"
    deps.sessionStates.set(sessionID, createFallbackState("anthropic/claude-opus-4-7"))
    deps.sessionAwaitingFallbackResult.add(sessionID)

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await flushPromptGateMicrotasks()
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    if (!releaseMessages) throw new Error("message lookup did not start")
    releaseMessages()
    await retryPromise

    // then
    expect(replacementState.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given a fallback prompt is queued behind an active assistant #when state is replaced before the queue drains #then the stale generation never reaches promptAsync", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-stale-queued-dispatch"
    let assistantIsActive = true
    deps.ctx.client.session.messages = async () => ({
      data: assistantIsActive
        ? [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry this" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "reasoning", text: "still active" }],
            },
          ]
        : [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "replacement request" }],
            },
            {
              info: { role: "assistant", finish: true },
              parts: [],
            },
          ],
    })
    const originalState = createFallbackState("anthropic/claude-opus-4-7")
    deps.sessionStates.set(sessionID, originalState)
    const helpers = createAutoRetryHelpers(deps)
    const clock = installRuntimeFallbackTestClock()

    // when
    const outcome = await helpers.autoRetryWithFallback(
      sessionID,
      "openai/gpt-5.4",
      undefined,
      "session.error",
    )
    expect(outcome).toEqual({ accepted: true, status: "queued" })
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    assistantIsActive = false
    await flushPromptGateMicrotasks()
    await clock.advanceBy(DEFAULT_PROMPT_QUEUE_RETRY_MS)
    await flushPromptGateMicrotasks()

    // then
    expect(promptCalls.count).toBe(0)
    expect(replacementState.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given state is replaced while fallback message lookup is pending #when the lookup completes #then the stale generation cannot dispatch or arm a watchdog", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-stale-before-dispatch"
    const state = createFallbackState("anthropic/claude-opus-4-7")
    state.pendingFallbackModel = "openai/gpt-5.4"
    deps.sessionStates.set(sessionID, state)
    let releaseMessages: (() => void) | undefined
    let markLookupStarted: (() => void) | undefined
    const lookupStarted = new Promise<void>((resolve) => {
      markLookupStarted = resolve
    })
    let messageCallCount = 0
    deps.ctx.client.session.messages = () => {
      messageCallCount += 1
      if (messageCallCount === 1) {
        markLookupStarted?.()
        return new Promise((resolve) => {
          releaseMessages = () => resolve({
            data: [
              {
                info: { role: "user" },
                parts: [{ type: "text", text: "retry this" }],
              },
            ],
          })
        })
      }
      return Promise.resolve({
        data: [
          {
            info: { role: "user" },
            parts: [{ type: "text", text: "replacement request" }],
          },
          {
            info: { role: "assistant", finish: true },
            parts: [],
          },
        ],
      })
    }
    const helpers = createAutoRetryHelpers(deps)

    // when
    const retryPromise = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await lookupStarted
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    if (!releaseMessages) throw new Error("message lookup did not start")
    releaseMessages()
    const outcome = await retryPromise

    // then
    expect(outcome).toEqual({
      accepted: false,
      status: "blocked",
      reason: "stale fallback generation",
    })
    expect(promptCalls.count).toBe(0)
    expect(deps.sessionAwaitingFallbackResult.has(sessionID)).toBe(false)
    expect(deps.sessionFallbackTimeouts.has(sessionID)).toBe(false)
    expect(replacementState.currentModel).toBe("google/gemini-2.5-pro")
  })

  test("#given a manual reset starts a new retry while the old dispatcher is awaiting messages #when the old generation completes #then it cannot clear the new generation in-flight marker", async () => {
    // given
    const promptCalls = { count: 0 }
    const deps = createDeps(promptCalls)
    const sessionID = "session-reset-retry-generation"
    let releaseStaleLookup: (() => void) | undefined
    let releaseCurrentLookup: (() => void) | undefined
    let markStaleLookupStarted: (() => void) | undefined
    let markCurrentLookupStarted: (() => void) | undefined
    const staleLookupStarted = new Promise<void>((resolve) => {
      markStaleLookupStarted = resolve
    })
    const currentLookupStarted = new Promise<void>((resolve) => {
      markCurrentLookupStarted = resolve
    })
    const retryResponse = {
      data: [
        {
          info: { role: "user" },
          parts: [{ type: "text", text: "retry this" }],
        },
      ],
    }
    let lookupCount = 0
    deps.ctx.client.session.messages = () => {
      lookupCount += 1
      if (lookupCount > 2) return Promise.resolve(retryResponse)
      return new Promise((resolve) => {
        if (lookupCount === 1) {
          markStaleLookupStarted?.()
          releaseStaleLookup = () => resolve(retryResponse)
        } else {
          markCurrentLookupStarted?.()
          releaseCurrentLookup = () => resolve(retryResponse)
        }
      })
    }
    const helpers = createAutoRetryHelpers(deps)
    deps.sessionStates.set(sessionID, createFallbackState("anthropic/claude-opus-4-7"))

    // when
    const staleRetry = helpers.autoRetryWithFallback(sessionID, "openai/gpt-5.4", undefined, "session.error")
    await staleLookupStarted
    const replacementState = createFallbackState("google/gemini-2.5-pro")
    deps.sessionStates.set(sessionID, replacementState)
    deps.sessionRetryInFlight.delete(sessionID)
    const currentRetry = helpers.autoRetryWithFallback(sessionID, "google/gemini-2.5-pro", undefined, "session.error")
    await currentLookupStarted
    if (!releaseStaleLookup) throw new Error("stale message lookup did not start")
    releaseStaleLookup()
    const staleOutcome = await staleRetry

    // then
    expect(staleOutcome).toEqual({
      accepted: false,
      status: "blocked",
      reason: "stale fallback generation",
    })
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(true)

    if (!releaseCurrentLookup) throw new Error("current message lookup did not start")
    releaseCurrentLookup()
    await currentRetry
    expect(deps.sessionRetryInFlight.has(sessionID)).toBe(false)
  })
})
