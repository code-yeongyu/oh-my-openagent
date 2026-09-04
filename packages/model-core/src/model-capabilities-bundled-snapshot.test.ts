import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import bundledModelCapabilitiesSnapshotJson from "../../../packages/omo-opencode/src/generated/model-capabilities.generated.json"

describe("bundled model capabilities snapshot", () => {
  describe("#given xAI grok models where maxTokens equals contextWindow", () => {
    test("#when resolving maxOutputTokens #then it is capped to a practical limit well below contextWindow", () => {
      // given
      const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
      const affectedModels = [
        { providerID: "xai", modelID: "xai/grok-4.5", contextWindow: 500_000 },
        { providerID: "xai", modelID: "xai/grok-4.6", contextWindow: 500_000 },
        { providerID: "xai", modelID: "xai/grok-build-0.1", contextWindow: 256_000 },
      ]

      // when
      const results = affectedModels.map(({ providerID, modelID, contextWindow }) => ({
        modelID,
        contextWindow,
        caps: getModelCapabilities({ providerID, modelID, bundledSnapshot }),
      }))

      // then — maxOutputTokens must be strictly less than half the context window
      // so OpenCode's getPromptContextWindow does not reserve half the window for output
      for (const { modelID, contextWindow, caps } of results) {
        expect(caps.maxOutputTokens).toBeDefined()
        expect(caps.maxOutputTokens!).toBeLessThan(contextWindow * 0.5)
      }
    })
  })

  test("keeps GPT-4.1 OpenAI variants marked as supporting tool calls", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const modelIDs = [
      "openai/gpt-4.1",
      "openai/gpt-4.1-mini",
      "openai/gpt-4.1-nano",
    ]

    // when
    const results = modelIDs.map((modelID) =>
      getModelCapabilities({
        providerID: "openai",
        modelID,
        bundledSnapshot,
      }),
    )

    // then
    for (const result of results) {
      expect(result.toolCall).toBe(true)
      expect(result.diagnostics).toMatchObject({
        resolutionMode: "snapshot-backed",
        snapshot: { source: "bundled-snapshot" },
        toolCall: { source: "bundled-snapshot" },
      })
    }
  })
})
