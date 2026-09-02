import { afterEach, describe, expect, spyOn, test } from "bun:test"
import * as shared from "../shared"
import { buildPrometheusAgentConfig } from "./prometheus-agent-config-builder"

describe("buildPrometheusAgentConfig disabled providers", () => {
  const availableModelsSpy = spyOn(shared, "fetchAvailableModels").mockResolvedValue(
    new Set(["anthropic/claude-fable-5", "opencode-go/kimi-k3"]),
  )
  const connectedProvidersSpy = spyOn(shared, "readConnectedProvidersCache").mockReturnValue([
    "anthropic",
    "opencode-go",
  ])

  afterEach(() => {
    availableModelsSpy.mockRestore()
    connectedProvidersSpy.mockRestore()
  })

  test("selects the next static fallback when a mirrored provider is disabled", async () => {
    // given
    const params = {
      configAgentPlan: undefined,
      pluginPrometheusOverride: undefined,
      userCategories: undefined,
      currentModel: undefined,
      disabledProviders: ["anthropic"] as const,
    }

    // when
    const result = await buildPrometheusAgentConfig(params)

    // then
    expect(result["model"]).toBe("opencode-go/kimi-k3")
    expect(result["variant"]).toBe("max")
  })
})
