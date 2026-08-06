import { describe, expect, test } from "bun:test"

import { getModelCapabilities, type ModelCapabilitiesSnapshot } from "./model-capabilities"

describe("getModelCapabilities heuristic fallback", () => {
  const bundledSnapshot: ModelCapabilitiesSnapshot = {
    generatedAt: "2026-03-25T00:00:00.000Z",
    sourceUrl: "https://models.dev/api.json",
    models: {},
  }

  test("detects OpenCode Go Qwen Max models through the heuristic fallback", () => {
    // given
    const modelID = "qwen3.7-max"

    // when
    const result = getModelCapabilities({
      providerID: "opencode-go",
      modelID,
      bundledSnapshot,
    })

    // then
    expect(result).toMatchObject({
      canonicalModelID: modelID,
      family: "qwen",
    })
    expect(result.diagnostics).toMatchObject({
      resolutionMode: "heuristic-backed",
      snapshot: { source: "none" },
      family: { source: "heuristic" },
    })
  })
})
