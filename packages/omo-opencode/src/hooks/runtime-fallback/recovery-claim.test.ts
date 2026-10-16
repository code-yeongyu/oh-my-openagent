import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"
import { _resetForTesting as resetClaudeCodeSessionState } from "../../features/claude-code-session-state"
import {
  _resetRuntimeFallbackRecoveryForTesting,
  awaitRuntimeFallbackRecoveryDecision,
  openRuntimeFallbackRecoveryClaim,
} from "../../shared/runtime-fallback-recovery"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

function createConfig(overrides?: Partial<RuntimeFallbackConfig>): RuntimeFallbackConfig {
  return {
    enabled: true,
    retry_on_errors: [429, 503, 529],
    max_fallback_attempts: 3,
    cooldown_seconds: 60,
    notify_on_fallback: false,
    restore_primary_after_cooldown: false,
    ...overrides,
  }
}

function createPluginConfig(fallbackModels: string[]): OhMyOpenCodeConfig {
  return {
    git_master: { commit_footer: true, include_co_authored_by: true, git_env_prefix: "GIT_MASTER=1" },
    categories: { test: { fallback_models: fallbackModels } },
  }
}

function createPluginInput(promptCalls: unknown[]): RuntimeFallbackPluginInput {
  return unsafeTestValue<RuntimeFallbackPluginInput>({
    client: {
      tui: { showToast: async () => ({}) },
      session: {
        messages: async () => ({ data: [{ info: { role: "user", id: "msg_original" }, parts: [{ type: "text", text: "do the work" }] }] }),
        promptAsync: async (args: unknown) => {
          promptCalls.push(args)
          return {}
        },
        abort: async () => ({}),
      },
    },
    directory: "/test/dir",
  })
}

type SessionErrorEvent = { type: string; properties: Record<string, unknown> }

function sessionError(sessionID: string, model?: string): SessionErrorEvent {
  return {
    type: "session.error",
    properties: { sessionID, ...(model ? { model } : {}), error: { statusCode: 429, message: "Rate limit" } },
  }
}

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: Error) => void }

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// The first promptAsync() call, which the retry dispatcher makes after marking the session's retry in flight,
// blocks until the test releases or refuses it. `started` resolves when that call is made.
function createGatedPluginInput(promptCalls: unknown[]) {
  const started = createDeferred<void>()
  const gate = createDeferred<void>()
  const base = createPluginInput(promptCalls)
  let gated = false
  const input = unsafeTestValue<RuntimeFallbackPluginInput>({
    ...base,
    client: {
      ...base.client,
      session: {
        ...base.client.session,
        promptAsync: async (args: unknown) => {
          if (!gated) {
            gated = true
            started.resolve()
            await gate.promise
          }
          promptCalls.push(args)
          return {}
        },
      },
    },
  })
  return { input, started: started.promise, release: () => gate.resolve(), refuse: (error: Error) => gate.reject(error) }
}

function sessionStatusRetry(sessionID: string): SessionErrorEvent {
  return {
    type: "session.status",
    properties: {
      sessionID,
      status: { type: "retry", attempt: 1, message: "Rate limit exceeded [retrying in 5s attempt #1]" },
    },
  }
}

const PENDING = "pending" as const

// Resolves to the decision if the claim is already settled, otherwise to PENDING. A settled claim resolves its
// waiter synchronously, so the decision promise is already resolved and listed first.
function decisionSoFar(decision: Promise<unknown> | undefined) {
  return Promise.race([decision, Promise.resolve(PENDING)])
}

describe("runtime-fallback recovery claim", () => {
  beforeEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
    SessionCategoryRegistry.clear()
    resetClaudeCodeSessionState()
    releaseAllPromptAsyncReservationsForTesting()
  })

  afterEach(() => {
    _resetRuntimeFallbackRecoveryForTesting()
    SessionCategoryRegistry.clear()
    resetClaudeCodeSessionState()
    releaseAllPromptAsyncReservationsForTesting()
  })

  async function startSession(hook: ReturnType<typeof createRuntimeFallbackHook>, sessionID: string, model: string) {
    SessionCategoryRegistry.register(sessionID, "test")
    await hook.event({ event: { type: "session.created", properties: { info: { id: sessionID, model } } } })
  }

  async function deliver(
    hook: ReturnType<typeof createRuntimeFallbackHook>,
    event: SessionErrorEvent,
  ) {
    openRuntimeFallbackRecoveryClaim(event, String(event.properties.sessionID))
    const decision = awaitRuntimeFallbackRecoveryDecision(event)
    await hook.event({ event })
    return decision
  }

  test("claims recovery when a fallback retry is accepted into the same session", async () => {
    // given
    const promptCalls: unknown[] = []
    const hook = createRuntimeFallbackHook(createPluginInput(promptCalls), {
      config: createConfig(),
      pluginConfig: createPluginConfig(["openai/gpt-5.4"]),
    })
    await startSession(hook, "ses_claim_accepted", "google/gemini-2.5-pro")

    // when
    const decision = await deliver(hook, sessionError("ses_claim_accepted", "google/gemini-2.5-pro"))

    // then
    expect(promptCalls).toHaveLength(1)
    expect(decision).toBe("retry-owned")
    hook.dispose?.()
  })

  test("declines when no fallback model is configured", async () => {
    // given
    const promptCalls: unknown[] = []
    const hook = createRuntimeFallbackHook(createPluginInput(promptCalls), {
      config: createConfig(),
      pluginConfig: createPluginConfig([]),
    })
    await startSession(hook, "ses_claim_no_models", "google/gemini-2.5-pro")

    // when
    const decision = await deliver(hook, sessionError("ses_claim_no_models", "google/gemini-2.5-pro"))

    // then
    expect(promptCalls).toHaveLength(0)
    expect(decision).toBe("declined")
    hook.dispose?.()
  })

  test("declines when the hook is disabled", async () => {
    // given
    const promptCalls: unknown[] = []
    const hook = createRuntimeFallbackHook(createPluginInput(promptCalls), {
      config: createConfig({ enabled: false }),
      pluginConfig: createPluginConfig(["openai/gpt-5.4"]),
    })

    // when
    const decision = await deliver(hook, sessionError("ses_claim_disabled", "google/gemini-2.5-pro"))

    // then
    expect(promptCalls).toHaveLength(0)
    expect(decision).toBeUndefined()
    hook.dispose?.()
  })

  test("keeps a stale error from the superseded generation under the live retry", async () => {
    // given
    const promptCalls: unknown[] = []
    const hook = createRuntimeFallbackHook(createPluginInput(promptCalls), {
      config: createConfig(),
      pluginConfig: createPluginConfig(["openai/gpt-5.4"]),
    })
    await startSession(hook, "ses_claim_stale", "google/gemini-2.5-pro")
    await deliver(hook, sessionError("ses_claim_stale", "google/gemini-2.5-pro"))

    // when
    const staleDecision = await deliver(hook, sessionError("ses_claim_stale", "google/gemini-2.5-pro"))

    // then
    expect(promptCalls).toHaveLength(1)
    expect(staleDecision).toBe("retry-owned")
    hook.dispose?.()
  })

  test("declines when the retry generation itself fails and no fallback remains", async () => {
    // given
    const promptCalls: unknown[] = []
    const hook = createRuntimeFallbackHook(createPluginInput(promptCalls), {
      config: createConfig(),
      pluginConfig: createPluginConfig(["openai/gpt-5.4"]),
    })
    await startSession(hook, "ses_claim_retry_failed", "google/gemini-2.5-pro")
    const firstDecision = await deliver(hook, sessionError("ses_claim_retry_failed", "google/gemini-2.5-pro"))

    // when
    const retryFailureDecision = await deliver(hook, sessionError("ses_claim_retry_failed"))

    // then
    expect(firstDecision).toBe("retry-owned")
    expect(retryFailureDecision).toBe("declined")
    hook.dispose?.()
  })

  test("stops claiming recovery after the hook is disposed", async () => {
    // given
    const hook = createRuntimeFallbackHook(createPluginInput([]), { config: createConfig() })
    hook.dispose?.()
    const event = sessionError("ses_claim_disposed", "google/gemini-2.5-pro")

    // when
    openRuntimeFallbackRecoveryClaim(event, "ses_claim_disposed")

    // then
    expect(awaitRuntimeFallbackRecoveryDecision(event)).toBeUndefined()
  })

  describe("when a session.status dispatch is in flight as the error arrives", () => {
    async function errorDuringStatusDispatch(sessionID: string) {
      const promptCalls: unknown[] = []
      const gated = createGatedPluginInput(promptCalls)
      const hook = createRuntimeFallbackHook(gated.input, {
        config: createConfig({ timeout_seconds: 0 }),
        pluginConfig: createPluginConfig(["openai/gpt-5.4", "anthropic/claude-opus-4-8"]),
      })
      await startSession(hook, sessionID, "google/gemini-2.5-pro")
      const statusHandled = hook.event({ event: sessionStatusRetry(sessionID) })
      await gated.started
      const event = sessionError(sessionID)
      openRuntimeFallbackRecoveryClaim(event, sessionID)
      // Not awaited: the decision may legitimately stay open until the dispatch settles.
      const decision = awaitRuntimeFallbackRecoveryDecision(event)
      await hook.event({ event })
      return { hook, gated, promptCalls, statusHandled, decision }
    }

    test("keeps the error's claim open until that dispatch settles", async () => {
      // given
      const { hook, gated, statusHandled, decision } = await errorDuringStatusDispatch("ses_claim_inflight_open")

      // when
      const beforeSettle = await decisionSoFar(decision)
      gated.release()
      await statusHandled

      // then
      expect(beforeSettle).toBe(PENDING)
      expect(await decision).toBe("retry-owned")
      hook.dispose?.()
    })

    test("declines the error when that dispatch is refused, so it is not dropped", async () => {
      // given
      const { hook, gated, promptCalls, statusHandled, decision } = await errorDuringStatusDispatch("ses_claim_inflight_refused")

      // when
      gated.refuse(new Error("upstream unavailable"))
      await statusHandled

      // then
      expect(promptCalls).toHaveLength(0)
      expect(await decision).toBe("declined")
      hook.dispose?.()
    })

    test("declines the error when the hook is disposed while that dispatch is in flight", async () => {
      // given
      const { hook, gated, statusHandled, decision } = await errorDuringStatusDispatch("ses_claim_inflight_disposed")

      // when
      hook.dispose?.()
      const afterDispose = await decisionSoFar(decision)
      gated.refuse(new Error("disposed"))
      await statusHandled

      // then
      expect(afterDispose).toBe("declined")
    })
  })

})
