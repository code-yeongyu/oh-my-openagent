import { describe, expect, test } from "bun:test"

import { getModelCapabilities } from "./model-capabilities"
import { resolveCompatibleModelSettings } from "./model-settings-compatibility"

describe("runtime variant reasoning efforts (#9140)", () => {
  const providerID = "local-llama"
  const modelID = "my-private-model-7b"
  const runtimeModel = {
    variants: {
      low: { reasoningEffort: "low" },
      high: { reasoningEffort: "high" },
    },
  }

  test("#given an unrecognized model whose config variants declare efforts #when a declared effort is requested #then it survives compatibility resolution", () => {
    // given
    const capabilities = getModelCapabilities({ providerID, modelID, runtimeModel })

    // when
    const result = resolveCompatibleModelSettings({
      providerID,
      modelID,
      desired: { variant: "high", reasoningEffort: "high" },
      capabilities,
    })

    // then
    expect(capabilities.reasoningEfforts).toEqual(["low", "high"])
    expect(capabilities.diagnostics.reasoningEfforts).toEqual({ source: "runtime" })
    expect(result.reasoningEffort).toBe("high")
    expect(result.changes).toEqual([])
  })

  test("#given an unrecognized model whose config variants declare efforts #when an undeclared effort is requested #then it is downgraded within the declared ladder", () => {
    // given
    const capabilities = getModelCapabilities({ providerID, modelID, runtimeModel })

    // when
    const result = resolveCompatibleModelSettings({
      providerID,
      modelID,
      desired: { reasoningEffort: "xhigh" },
      capabilities,
    })

    // then
    expect(result.reasoningEffort).toBe("high")
    expect(result.changes).toEqual([
      { field: "reasoningEffort", from: "xhigh", to: "high", reason: "unsupported-by-model-metadata" },
    ])
  })
})
