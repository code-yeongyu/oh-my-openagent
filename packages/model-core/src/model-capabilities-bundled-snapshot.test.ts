import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"
import bundledModelCapabilitiesSnapshotJson from "../../../packages/omo-opencode/src/generated/model-capabilities.generated.json"

describe("bundled model capabilities snapshot", () => {
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

  test("marks Moonshot Kimi reasoning models as NOT supporting arbitrary temperature", () => {
    // Moonshot's OpenAI-compatible API rejects any non-1 temperature for
    // these reasoning models with `invalid temperature: only 1 is allowed
    // for this model`. The capability resolver must report
    // `supportsTemperature: false` so the chat-params layer strips the
    // field before the outbound request, letting Moonshot default to 1.

    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot(bundledModelCapabilitiesSnapshotJson)
    const cases = [
      { providerID: "moonshotai", modelID: "kimi-k2.6" },
      { providerID: "moonshotai", modelID: "moonshotai/kimi-k2.6" },
      { providerID: "moonshotai", modelID: "kimi-k2-thinking" },
      { providerID: "moonshotai", modelID: "kimi-k2-thinking-turbo" },
      { providerID: "moonshotai", modelID: "kimi-k2.5-free" },
      { providerID: "moonshotai", modelID: "kimi-k2-5" },
    ]

    // when
    const results = cases.map(({ providerID, modelID }) =>
      ({
        modelID,
        capabilities: getModelCapabilities({
          providerID,
          modelID,
          bundledSnapshot,
        }),
      }),
    )

    // then
    for (const { modelID, capabilities } of results) {
      expect({ modelID, supportsTemperature: capabilities.supportsTemperature }).toEqual({
        modelID,
        supportsTemperature: false,
      })
      expect(capabilities.reasoning).toBe(true)
      expect(capabilities.diagnostics).toMatchObject({
        snapshot: { source: "bundled-snapshot" },
        supportsTemperature: { source: "bundled-snapshot" },
      })
    }
  })
})
