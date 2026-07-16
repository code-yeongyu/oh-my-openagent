import { afterEach, describe, expect, test } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRuntimeFallbackHook } from "./hook"
import {
  installRuntimeFallbackTestClock,
  restoreRuntimeFallbackTestClock,
} from "./test-timeout-clock.test-support"
import type { RuntimeFallbackPluginInput } from "./types"

const SESSION_ID = "test-session-context-overflow-compaction"

describe("runtime-fallback context overflow handling", () => {
  afterEach(() => {
    restoreRuntimeFallbackTestClock()
    SessionCategoryRegistry.clear()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("leaves native compaction active after the fallback timeout window", async () => {
    //#given
    const clock = installRuntimeFallbackTestClock()
    const promptCalls: unknown[] = []
    const abortCalls: unknown[] = []
    const config = {
      enabled: true,
      retry_on_errors: [400, 429, 500, 502, 503, 504],
      max_fallback_attempts: 3,
      cooldown_seconds: 30,
      timeout_seconds: 30,
      notify_on_fallback: false,
      restore_primary_after_cooldown: false,
    } satisfies RuntimeFallbackConfig
    const pluginConfig = {
      categories: {
        test: {
          fallback_models: ["winson/codex/gpt-5.6-luna"],
        },
      },
    } satisfies OhMyOpenCodeConfig
    const hook = createRuntimeFallbackHook(
      unsafeTestValue<RuntimeFallbackPluginInput>({
        client: {
          session: {
            messages: async () => ({ data: [] }),
            promptAsync: async (input: unknown) => {
              promptCalls.push(input)
              return {}
            },
            abort: async (input: unknown) => {
              abortCalls.push(input)
              return {}
            },
          },
          tui: { showToast: async () => ({}) },
        },
        directory: "/test/dir",
      }),
      { config, pluginConfig },
    )
    SessionCategoryRegistry.register(SESSION_ID, "test")
    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: SESSION_ID, model: "winson/codex/gpt-5.6-sol" } },
      },
    })

    //#when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID: SESSION_ID,
          error: {
            name: "ContextOverflowError",
            data: {
              message:
                "Your input exceeds the context window of this model. Please adjust your input and try again.",
              responseBody:
                '{"error":{"message":"Your input exceeds the context window of this model. Please adjust your input and try again.","type":"invalid_request_error","code":"context_too_large"}}',
            },
          },
        },
      },
    })
    await clock.advanceBy(31_000)

    //#then
    expect(promptCalls).toHaveLength(0)
    expect(abortCalls).toHaveLength(0)
    hook.dispose?.()
  })
})
