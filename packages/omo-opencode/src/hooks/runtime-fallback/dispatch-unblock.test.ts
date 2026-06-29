import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

function createMockConfig(): RuntimeFallbackConfig {
  return {
    enabled: true,
    retry_on_errors: [429, 503, 529],
    max_fallback_attempts: 3,
    cooldown_seconds: 60,
    notify_on_fallback: false,
    restore_primary_after_cooldown: false,
  }
}

function createMockPluginConfig(): OhMyOpenCodeConfig {
  return {
    git_master: {
      commit_footer: true,
      include_co_authored_by: true,
      git_env_prefix: "GIT_MASTER=1",
    },
    categories: {
      test: {
        model: "anthropic/claude-haiku-4-5",
        fallback_models: ["openai/gpt-5.4"],
      },
    },
  }
}

function createMockPluginInput(args: {
  readonly messages: () => Promise<unknown>
  readonly abort: (input: unknown) => Promise<unknown>
  readonly promptAsync: (input: unknown) => Promise<unknown>
}): RuntimeFallbackPluginInput {
  return unsafeTestValue<RuntimeFallbackPluginInput>({
    client: {
      tui: {
        showToast: async () => ({}),
      },
      session: {
        messages: args.messages,
        abort: args.abort,
        promptAsync: args.promptAsync,
      },
    },
    directory: "/test/dir",
  })
}

describe("runtime fallback dispatch unblock", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    releaseAllPromptAsyncReservationsForTesting()
  })

  test("#given HTTP 429 leaves an incomplete assistant turn #when runtime fallback retries #then it aborts the failed turn and dispatches one fallback prompt", async () => {
    // given
    const promptCalls: unknown[] = []
    const abortCalls: unknown[] = []
    let failedAssistantTurnActive = true
    const sessionID = "test-429-incomplete-assistant-unblocks-fallback"
    const hook = createRuntimeFallbackHook(
      createMockPluginInput({
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry after rate limit" }],
            },
            failedAssistantTurnActive
              ? {
                  info: { role: "assistant" },
                  parts: [{ type: "error", text: "HTTP 429: rate limit exceeded" }],
                }
              : {
                  info: { role: "assistant", error: { statusCode: 429 }, time: { completed: Date.now() } },
                  parts: [{ type: "error", text: "HTTP 429: rate limit exceeded" }],
                },
          ],
        }),
        abort: async (input) => {
          abortCalls.push(input)
          failedAssistantTurnActive = false
          return {}
        },
        promptAsync: async (input) => {
          promptCalls.push(input)
          return {}
        },
      }),
      {
        config: createMockConfig(),
        pluginConfig: createMockPluginConfig(),
      },
    )
    SessionCategoryRegistry.register(sessionID, "test")

    // when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { statusCode: 429, message: "Rate limit exceeded" },
        },
      },
    })

    // then
    expect(abortCalls).toHaveLength(1)
    expect(promptCalls).toHaveLength(1)
  })

  test("#given an auth failure leaves an incomplete assistant turn #when runtime fallback observes it #then it does not abort or dispatch fallback", async () => {
    // given
    const promptCalls: unknown[] = []
    const abortCalls: unknown[] = []
    const sessionID = "test-auth-incomplete-assistant-still-blocks-fallback"
    const hook = createRuntimeFallbackHook(
      createMockPluginInput({
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "retry after auth failure" }],
            },
            {
              info: { role: "assistant" },
              parts: [{ type: "error", text: "HTTP 401: invalid bearer token" }],
            },
          ],
        }),
        abort: async (input) => {
          abortCalls.push(input)
          return {}
        },
        promptAsync: async (input) => {
          promptCalls.push(input)
          return {}
        },
      }),
      {
        config: createMockConfig(),
        pluginConfig: createMockPluginConfig(),
      },
    )
    SessionCategoryRegistry.register(sessionID, "test")

    // when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: { statusCode: 401, message: "invalid bearer token" },
        },
      },
    })

    // then
    expect(abortCalls).toHaveLength(0)
    expect(promptCalls).toHaveLength(0)
  })
})
