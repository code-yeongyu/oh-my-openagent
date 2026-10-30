import { describe, expect, test } from "bun:test"

import { childModelChainSpec } from "./memory-child-model-chain"

describe("childModelChainSpec", () => {
  test("#given a resolved quick chain #when converted #then the primary selector and the in-category fallback records are produced", () => {
    // given / when
    const chain = childModelChainSpec({
      model: "omo-mock/mock-1",
      fallbacks: [{ model: "omo-mock/mock-2" }, { model: "apitopia/z-ai/glm-5.3", thinking: "high" }],
    })

    // then: the chain key is the bare primary selector; a nested-slash model id keeps its provider split
    // at the first slash, and a candidate's thinking level rides on the canonical `reasoning` field.
    expect(chain).toEqual({
      selectedModel: "omo-mock/mock-1",
      fallbackModels: [
        { provider: "omo-mock", model_id: "mock-2", display: "omo-mock/mock-2", source: "category" },
        { provider: "apitopia", model_id: "z-ai/glm-5.3", display: "apitopia/z-ai/glm-5.3", reasoning: "high", source: "category" },
      ],
      retry: { maxRetries: 1 },
    })
  })

  test("#given a single-model quick category #when converted #then fallback and retry overrides are absent", () => {
    expect(childModelChainSpec({ model: "omo-mock/mock-1", fallbacks: [] }))
      .toEqual({ selectedModel: "omo-mock/mock-1" })
  })
})
