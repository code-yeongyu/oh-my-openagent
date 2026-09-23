import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import {
  installRuntimeFallbackTestClock,
  restoreRuntimeFallbackTestClock,
} from "./test-timeout-clock.test-support"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackHook, RuntimeFallbackPluginInput } from "./types"

let activeHook: RuntimeFallbackHook | undefined

afterEach(() => {
  activeHook?.dispose?.()
  activeHook = undefined
  restoreRuntimeFallbackTestClock()
  SessionCategoryRegistry.clear()
  releaseAllPromptAsyncReservationsForTesting()
})

describe("GitHub Copilot 429 runtime fallback", () => {
  test("#given a Copilot 429 with Retry-After #when the next fallback is Copilot #then promptAsync waits through the server window", async () => {
    // given
    const clock = installRuntimeFallbackTestClock()
    const sessionID = "copilot-retry-after-backoff"
    let promptCalls = 0
    let messageRequests = 0
    let releaseAgentResolution: (() => void) | undefined
    const agentResolution = new Promise<void>((resolve) => {
      releaseAgentResolution = resolve
    })
    const ctx = unsafeTestValue<RuntimeFallbackPluginInput>({
      client: {
        session: {
          abort: async () => ({}),
          messages: async () => {
            messageRequests += 1
            if (messageRequests === 1) await agentResolution
            return {
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }],
            }
          },
          promptAsync: async () => {
            promptCalls += 1
            return {}
          },
        },
        tui: { showToast: async () => ({}) },
      },
      directory: "/test/dir",
    })
    const config: RuntimeFallbackConfig = {
      enabled: true,
      retry_on_errors: [429, 503],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    }
    const pluginConfig = unsafeTestValue<OhMyOpenCodeConfig>({
      categories: {
        test: {
          fallback_models: ["github-copilot/gpt-5.6", "openai/gpt-5.6"],
        },
      },
    })
    const hook = createRuntimeFallbackHook(ctx, { config, pluginConfig })
    activeHook = hook
    SessionCategoryRegistry.register(sessionID, "test")
    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, model: "github-copilot/gpt-5.5" } },
      },
    })

    // when
    const retry = hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          model: "github-copilot/gpt-5.5",
          error: { statusCode: 429, response: { headers: { "Retry-After": "12" } } },
        },
      },
    })
    await hook.event({
      event: {
        type: "session.status",
        properties: {
          sessionID,
          model: "github-copilot/gpt-5.6",
          status: {
            type: "retry",
            message: "Too Many Requests: quota exceeded [retrying in 12 seconds attempt #1]",
          },
        },
      },
    })
    expect(promptCalls).toBe(0)
    releaseAgentResolution?.()
    for (let flushes = 0; flushes < 20; flushes += 1) {
      await Promise.resolve()
    }
    await clock.advanceBy(12_250)
    await retry

    // then
    expect(promptCalls).toBe(1)
  })
})
