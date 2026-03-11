/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { createContextWindowMonitorHook } from "./context-window-monitor"

function createOutput() {
  return { title: "", output: "original", metadata: null }
}

describe("context-window-monitor modelContextLimitsCache", () => {
  it("does not append reminder below cached non-anthropic threshold", async () => {
    // given
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("opencode/kimi-k2.5-free", 262144)

    const hook = createContextWindowMonitorHook({} as never, {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })
    const sessionID = "ses_non_anthropic_below_threshold"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "opencode",
            modelID: "kimi-k2.5-free",
            finish: true,
            tokens: {
              input: 150000,
              output: 0,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    // when
    const output = createOutput()
    await hook["tool.execute.after"]({ tool: "bash", sessionID, callID: "call_1" }, output)

    // then
    expect(output.output).toBe("original")
  })

  it("appends reminder above cached non-anthropic threshold", async () => {
    // given
    const modelContextLimitsCache = new Map<string, number>()
    modelContextLimitsCache.set("opencode/kimi-k2.5-free", 262144)

    const hook = createContextWindowMonitorHook({} as never, {
      anthropicContext1MEnabled: false,
      modelContextLimitsCache,
    })
    const sessionID = "ses_non_anthropic_above_threshold"

    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            role: "assistant",
            sessionID,
            providerID: "opencode",
            modelID: "kimi-k2.5-free",
            finish: true,
            tokens: {
              input: 180000,
              output: 0,
              reasoning: 0,
              cache: { read: 10000, write: 0 },
            },
          },
        },
      },
    })

    // when
    const output = createOutput()
    await hook["tool.execute.after"]({ tool: "bash", sessionID, callID: "call_1" }, output)

    // then
    expect(output.output).toContain("context remaining")
    expect(output.output).toContain("262,144-token context window")
    expect(output.output).toContain("[Context Status: 72.5% used (190,000/262,144 tokens), 27.5% remaining]")
    expect(output.output).not.toContain("1,000,000")
  })

  describe("#given Anthropic provider with cached context limit and 1M mode enabled", () => {
    describe("#when cached usage would exceed 200K but stay below 1M", () => {
      it("#then should ignore the cached limit and skip the reminder", async () => {
        // given
        const modelContextLimitsCache = new Map<string, number>()
        modelContextLimitsCache.set("anthropic/claude-sonnet-4-5", 200000)

        const hook = createContextWindowMonitorHook({} as never, {
          anthropicContext1MEnabled: true,
          modelContextLimitsCache,
        })
        const sessionID = "ses_anthropic_1m_overrides_cached_limit"

        await hook.event({
          event: {
            type: "message.updated",
            properties: {
              info: {
                role: "assistant",
                sessionID,
                providerID: "anthropic",
                modelID: "claude-sonnet-4-5",
                finish: true,
                tokens: {
                  input: 300000,
                  output: 0,
                  reasoning: 0,
                  cache: { read: 0, write: 0 },
                },
              },
            },
          },
        })

        // when
        const output = createOutput()
        await hook["tool.execute.after"]({ tool: "bash", sessionID, callID: "call_1" }, output)

        // then
        expect(output.output).toBe("original")
      })
    })
  })
})
