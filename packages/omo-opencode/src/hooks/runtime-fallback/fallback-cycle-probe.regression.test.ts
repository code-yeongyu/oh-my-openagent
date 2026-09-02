import { describe, expect, it } from "bun:test"

import { FallbackCycleRegistry } from "../shared/fallback-cycle-registry"
import { createRuntimeFallbackHook } from "./hook"
import type { RuntimeFallbackPluginInput } from "./types"

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

const pluginConfig = {
  agents: {
    sisyphus: {
      model: "anthropic/claude-opus-4-7",
      fallback_models: ["openai/gpt-5.4"],
    },
  },
} as never

describe("runtime-fallback shared fallback-cycle probe (#2063)", () => {
  it("#given a dispatched fallback retry #when the cycle is awaiting the fallback result #then the shared registry reports the cycle active until it is cleaned up", async () => {
    // given
    const sessionID = "ses-sisyphus-probe-active"
    const promptCalls = { count: 0 }
    const hook = createRuntimeFallbackHook(createContext(promptCalls), {
      config: { enabled: true, notify_on_fallback: false },
      pluginConfig,
    })

    try {
      // when
      await hook.event({
        event: {
          type: "session.created",
          properties: {
            info: {
              id: sessionID,
              agent: "sisyphus",
              model: { providerID: "anthropic", id: "claude-opus-4-7" },
            },
          },
        },
      })
      await hook.event({
        event: {
          type: "session.error",
          properties: {
            sessionID,
            error: { name: "RateLimitError", message: "429 rate limit exceeded" },
          },
        },
      })

      // then
      expect(promptCalls.count).toBeGreaterThan(0)
      expect(FallbackCycleRegistry.isActive(sessionID)).toBe(true)

      // when — session.idle fires while the fallback result is still pending
      await hook.event({ event: { type: "session.idle", properties: { sessionID } } })

      // then — the cycle is still in progress
      expect(FallbackCycleRegistry.isActive(sessionID)).toBe(true)

      // when — the session is stopped and retry state is reset
      await hook.event({ event: { type: "session.stop", properties: { sessionID } } })

      // then
      expect(FallbackCycleRegistry.isActive(sessionID)).toBe(false)
    } finally {
      hook.dispose()
    }
  })

  it("#given a disposed runtime-fallback hook #when isActive is queried #then no probe answers", async () => {
    // given
    const promptCalls = { count: 0 }
    const hook = createRuntimeFallbackHook(createContext(promptCalls), {
      config: { enabled: true, notify_on_fallback: false },
      pluginConfig,
    })

    // when
    hook.dispose()

    // then
    expect(FallbackCycleRegistry.isActive("ses-sisyphus-probe-disposed")).toBe(false)
  })
})
