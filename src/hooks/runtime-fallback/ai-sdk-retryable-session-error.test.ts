import { afterEach, describe, expect, test } from "bun:test"
import { unsafeTestValue } from "../../../test-support/unsafe-test-value"
import type { OhMyOpenCodeConfig, RuntimeFallbackConfig } from "../../config"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { releaseAllPromptAsyncReservationsForTesting } from "../shared/prompt-async-gate"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

describe("runtime-fallback AI SDK retryable session errors", () => {
  afterEach(() => {
    SessionCategoryRegistry.clear()
    releaseAllPromptAsyncReservationsForTesting()
  })

  function createRuntimeFallbackConfig(): RuntimeFallbackConfig {
    return {
      enabled: true,
      retry_on_errors: [429, 500, 502, 503, 504],
      max_fallback_attempts: 3,
      cooldown_seconds: 60,
      notify_on_fallback: false,
    }
  }

  function createPluginConfig(): OhMyOpenCodeConfig {
    return {
      git_master: {
        commit_footer: true,
        include_co_authored_by: true,
        git_env_prefix: "GIT_MASTER=1",
      },
      categories: {
        test: {
          fallback_models: ["openai/gpt-5.4"],
        },
      },
    }
  }

  test("dispatches fallback for nested AI SDK retryable Cloudflare timeout errors", async () => {
    //#given
    const promptCalls: Array<Record<string, unknown>> = []
    const hook = createRuntimeFallbackHook(
      unsafeTestValue<RuntimeFallbackPluginInput>({
        client: {
          tui: { showToast: async () => ({}) },
          session: {
            messages: async () => ({
              data: [{ info: { role: "user" }, parts: [{ type: "text", text: "continue" }] }],
            }),
            promptAsync: async (args: unknown) => {
              promptCalls.push(args as Record<string, unknown>)
              return {}
            },
            abort: async () => ({}),
          },
        },
        directory: "/test/dir",
      }),
      { config: createRuntimeFallbackConfig(), pluginConfig: createPluginConfig() },
    )
    const sessionID = "test-session-ai-sdk-cloudflare-timeout"
    SessionCategoryRegistry.register(sessionID, "test")

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, model: "openai/gpt-5.5-fast" } },
      },
    })

    //#when
    await hook.event({
      event: {
        type: "session.error",
        properties: {
          sessionID,
          error: {
            error: {
              name: "AI_APICallError",
              statusCode: 524,
              isRetryable: true,
              responseBody: "<title>mengmota.com | 524: A timeout occurred</title>",
            },
          },
        },
      },
    })

    //#then
    expect(promptCalls).toHaveLength(1)
    const promptBody = promptCalls[0]?.body as { model?: { providerID?: string; modelID?: string } } | undefined
    expect(promptBody?.model).toEqual({ providerID: "openai", modelID: "gpt-5.4" })
  })
})
