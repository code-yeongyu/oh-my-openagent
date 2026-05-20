import { describe, expect, test } from "bun:test"

import { getBundledModelCapabilitiesSnapshot, getModelCapabilities } from "./model-capabilities"

describe("bundled model capabilities snapshot", () => {
  test("keeps GPT-4.1 OpenAI variants marked as supporting tool calls", () => {
    // given
    const bundledSnapshot = getBundledModelCapabilitiesSnapshot()
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
