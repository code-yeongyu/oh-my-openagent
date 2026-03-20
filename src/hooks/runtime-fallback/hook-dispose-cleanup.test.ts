import { describe, expect, it } from "bun:test"
import type { RuntimeFallbackPluginInput } from "./types"
import { createRuntimeFallbackHook } from "./hook"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

function createContext(promptCalls: unknown[]): RuntimeFallbackPluginInput {
  return {
    client: {
      session: {
        abort: async () => ({}),
        messages: async () => ({
          data: [{ info: { role: "user" }, parts: [{ type: "text", text: "retry this" }] }],
        }),
        promptAsync: async (args: unknown) => {
          promptCalls.push(args)
          return {}
        },
      },
      tui: {
        showToast: async () => ({}),
      },
    },
    directory: "/test/dir",
  }
}

describe("createRuntimeFallbackHook dispose retry-key cleanup", () => {
  it("#given a session.status retry key #when dispose() is called #then the same retry event is not deduplicated afterward", async () => {
    // given
    const promptCalls: unknown[] = []
    const sessionID = "session-dispose-retry-key"
    const hook = createRuntimeFallbackHook(createContext(promptCalls), {
      config: {
        enabled: true,
        retry_on_errors: [429, 503, 529],
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 30,
        notify_on_fallback: false,
      },
      pluginConfig: {
        categories: {
          test: {
            fallback_models: ["openai/gpt-5.2"],
          },
        },
      },
    })
    SessionCategoryRegistry.register(sessionID, "test")

    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, model: "quotio/claude-opus-4-6" } },
      },
    })

    const retryEvent = {
      event: {
        type: "session.status",
        properties: {
          sessionID,
          status: {
            type: "retry",
            attempt: 1,
            message: "All credentials for model claude-opus-4-6 are cooling down [retrying in 7m 56s attempt #1]",
          },
        },
      },
    }

    await hook.event(retryEvent)
    expect(promptCalls).toHaveLength(1)

    // when
    hook.dispose?.()
    await hook.event({
      event: {
        type: "session.created",
        properties: { info: { id: sessionID, model: "quotio/claude-opus-4-6" } },
      },
    })
    await hook.event(retryEvent)

    // then
    expect(promptCalls).toHaveLength(2)
  })
})
