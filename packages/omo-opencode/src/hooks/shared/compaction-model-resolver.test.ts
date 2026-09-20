/// <reference types="bun-types" />

import { afterEach, describe, expect, it } from "bun:test"

import {
  clearSessionAgent,
  updateSessionAgent,
} from "../../features/claude-code-session-state"

import { resolveCompactionModel, resolveCompactionModelDecision } from "./compaction-model-resolver"

const SESSION_MODEL = { providerID: "opencode-go", modelID: "deepseek-v4.1-flash" } as const

const pluginConfig = {
  agents: {
    sisyphus: { compaction: { model: "zai-coding-plan/glm-5.3-flash" } },
    "sisyphus-junior": { compaction: { model: "zai-coding-plan/glm-5.3-flash" } },
    prometheus: { compaction: { model: "openai/gpt-5.6-luna" } },
    oracle: { model: "openai/gpt-5.6-luna" },
    "weird pin": { compaction: { model: "glm-5.3-flash" } },
    acme: { compaction: { model: "zai-coding-plan/glm-5.3-flash" } },
  },
} as never

function resolve(sessionID: string, fallbackAgentName?: string) {
  return resolveCompactionModel(
    pluginConfig,
    sessionID,
    SESSION_MODEL.providerID,
    SESSION_MODEL.modelID,
    fallbackAgentName,
  )
}

describe("compaction model resolver", () => {
  afterEach(() => {
    clearSessionAgent("ses_pin")
    clearSessionAgent("ses_display")
    clearSessionAgent("ses_persona")
    clearSessionAgent("ses_unpinned")
    clearSessionAgent("ses_malformed")
    clearSessionAgent("ses_no_config")
    clearSessionAgent("ses_custom")
  })

  it("uses the pinned summarizer for the configured agent key", () => {
    updateSessionAgent("ses_pin", "sisyphus")

    expect(resolve("ses_pin")).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
  })

  it("uses the pinned summarizer when the session carries the display name", () => {
    updateSessionAgent("ses_display", "Sisyphus - ultraworker")

    expect(resolve("ses_display")).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
  })

  it("resolves a persona-suffixed variant of a canonical agent to that agent's pin", () => {
    updateSessionAgent("ses_persona", "Sisyphus - review bot")

    expect(resolve("ses_persona")).toEqual({ providerID: "zai-coding-plan", modelID: "glm-5.3-flash" })
  })

  it("does not lend the base agent's pin to an unrelated custom agent", () => {
    updateSessionAgent("ses_custom", "acme - review bot")

    const decision = resolveCompactionModelDecision(
      pluginConfig,
      "ses_custom",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
    )

    expect(decision.source).toBe("session")
    expect(decision.reason).toBe("agent-not-configured")
    expect(resolve("ses_custom")).toEqual(SESSION_MODEL)
  })

  it("uses the observed agent when the session agent map is empty", () => {
    expect(resolve("ses_missing_map", "sisyphus-junior")).toEqual({
      providerID: "zai-coding-plan",
      modelID: "glm-5.3-flash",
    })
  })

  it("falls back to the session model when the agent has no pin", () => {
    updateSessionAgent("ses_unpinned", "oracle")

    const decision = resolveCompactionModelDecision(
      pluginConfig,
      "ses_unpinned",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
    )

    expect(decision.source).toBe("session")
    expect(decision.reason).toBe("no-compaction-pin")
    expect(resolve("ses_unpinned")).toEqual(SESSION_MODEL)
  })

  it("reports no-agent-name when nothing identifies the session agent", () => {
    const decision = resolveCompactionModelDecision(
      pluginConfig,
      "ses_unknown_agent",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
    )

    expect(decision.source).toBe("session")
    expect(decision.reason).toBe("no-agent-name")
  })

  it("rejects a pin without a provider prefix", () => {
    updateSessionAgent("ses_malformed", "weird pin")

    const decision = resolveCompactionModelDecision(
      pluginConfig,
      "ses_malformed",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
    )

    expect(decision.source).toBe("session")
    expect(decision.reason).toBe("malformed-pin")
  })

  it("reports no-agents-config when the plugin config has no overrides", () => {
    updateSessionAgent("ses_no_config", "sisyphus")

    const decision = resolveCompactionModelDecision(
      {} as never,
      "ses_no_config",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
    )

    expect(decision.source).toBe("session")
    expect(decision.reason).toBe("no-agents-config")
  })

  it("keeps the provider and joins multi-segment model ids", () => {
    const decision = resolveCompactionModelDecision(
      { agents: { sisyphus: { compaction: { model: "opencode-go/deepseek/v4" } } } } as never,
      "ses_multiseg",
      SESSION_MODEL.providerID,
      SESSION_MODEL.modelID,
      "sisyphus",
    )

    expect(decision).toEqual({
      providerID: "opencode-go",
      modelID: "deepseek/v4",
      source: "pin",
      reason: "pin:sisyphus",
      agentName: "sisyphus",
      agentConfigKey: "sisyphus",
      pinnedModel: "opencode-go/deepseek/v4",
    })
  })
})
