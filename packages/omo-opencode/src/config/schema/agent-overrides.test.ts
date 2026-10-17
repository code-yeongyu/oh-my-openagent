import { describe, expect, test } from "bun:test"
import { OhMyOpenCodeConfigSchema } from "../schema"
import { findUnknownKeyPaths } from "../../plugin-config/unknown-key-diagnostics"
import { AgentOverridesSchema } from "./agent-overrides"

describe("AgentOverridesSchema", () => {
  test("preserves custom agent keys after parsing", () => {
    const input = {
      sisyphus: { model: "anthropic/claude-opus-4-6" },
      "technical-writer": {
        model: "anthropic/claude-sonnet-4-6",
        temperature: 0.3,
        prompt_append: "You are a technical writer.",
      },
    }

    const result = AgentOverridesSchema.safeParse(input)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sisyphus).toBeDefined()
      expect(result.data["technical-writer"]).toBeDefined()
      expect(result.data["technical-writer"]?.model).toBe("anthropic/claude-sonnet-4-6")
      expect(result.data["technical-writer"]?.temperature).toBe(0.3)
    }
  })

  test("accepts canonical reasoning on agents and per-message overrides", () => {
    // given
    const input = {
      sisyphus: {
        reasoning: "xhigh",
        ultrawork: { reasoning: "max" },
        compaction: { reasoning: "off" },
      },
    }

    // when
    const result = AgentOverridesSchema.safeParse(input)

    // then
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sisyphus?.reasoning).toBe("xhigh")
      expect(result.data.sisyphus?.ultrawork?.reasoning).toBe("max")
      expect(result.data.sisyphus?.compaction?.reasoning).toBe("off")
    }
  })

  test("validates custom agent keys against AgentOverrideConfigSchema", () => {
    const input = {
      "custom-agent": {
        model: "provider/model",
        temperature: 5, // invalid: max is 2
      },
    }

    const result = AgentOverridesSchema.safeParse(input)

    expect(result.success).toBe(false)
  })

  test("accepts installer-shaped mixed models chains without unknown-key diagnostics", () => {
    // given — OpenCode Go install writes a string primary plus object fallbacks
    const installerModels = [
      "opencode-go/qwen3.7-plus",
      { model: "opencode-go/minimax-m3" },
      { model: "opencode-go/minimax-m2.7" },
    ]
    const config = {
      agents: {
        librarian: { models: installerModels },
        explore: { models: installerModels },
        atlas: { models: installerModels },
        "sisyphus-junior": { models: installerModels },
      },
    }

    // when
    const parsed = AgentOverridesSchema.safeParse(config.agents)
    const unknown = findUnknownKeyPaths(OhMyOpenCodeConfigSchema, config)

    // then
    expect(parsed.success).toBe(true)
    expect(unknown).toEqual([])
  })
})
