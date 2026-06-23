import { describe, expect, it } from "bun:test"
import {
  RETRIEVAL_PRESETS,
  buildAdvancedRetrievalParams,
  estimateLatencyOverhead,
  getRetrievalPreset,
} from "./advanced-retrieval"

describe("estimateLatencyOverhead", () => {
  it("#given fast preset #when estimated #then returns 0ms", () => {
    expect(estimateLatencyOverhead(RETRIEVAL_PRESETS.fast)).toBe(0)
  })

  it("#given balanced preset #when estimated #then returns 150ms", () => {
    expect(estimateLatencyOverhead(RETRIEVAL_PRESETS.balanced)).toBe(150)
  })

  it("#given recall preset #when estimated #then returns 160ms", () => {
    expect(estimateLatencyOverhead(RETRIEVAL_PRESETS.recall)).toBe(160)
  })

  it("#given precision preset #when estimated #then returns 410ms", () => {
    expect(estimateLatencyOverhead(RETRIEVAL_PRESETS.precision)).toBe(410)
  })

  it("#given only filter_memories #when estimated #then returns 250ms", () => {
    expect(
      estimateLatencyOverhead({
        rerank: false,
        keyword_search: false,
        filter_memories: true,
      }),
    ).toBe(250)
  })
})

describe("buildAdvancedRetrievalParams", () => {
  it("#given all false #when built #then maps all flags to false", () => {
    const params = buildAdvancedRetrievalParams({
      rerank: false,
      keyword_search: false,
      filter_memories: false,
    })
    expect(params).toEqual({
      rerank: false,
      keyword_search: false,
      filter_memories: false,
    })
  })

  it("#given mixed options #when built #then preserves each flag under correct key", () => {
    const params = buildAdvancedRetrievalParams({
      rerank: true,
      keyword_search: false,
      filter_memories: true,
    })
    expect(params.rerank).toBe(true)
    expect(params.keyword_search).toBe(false)
    expect(params.filter_memories).toBe(true)
  })
})

describe("getRetrievalPreset", () => {
  it("#given known preset name #when resolved #then returns matching options", () => {
    expect(getRetrievalPreset("fast")).toEqual(RETRIEVAL_PRESETS.fast)
    expect(getRetrievalPreset("balanced")).toEqual(RETRIEVAL_PRESETS.balanced)
    expect(getRetrievalPreset("recall")).toEqual(RETRIEVAL_PRESETS.recall)
    expect(getRetrievalPreset("precision")).toEqual(RETRIEVAL_PRESETS.precision)
  })

  it("#given unknown preset name #when resolved #then falls back to balanced", () => {
    expect(getRetrievalPreset("bogus-preset")).toEqual(RETRIEVAL_PRESETS.balanced)
    expect(getRetrievalPreset("")).toEqual(RETRIEVAL_PRESETS.balanced)
  })

  it("#given resolved preset #when mutated #then does not affect original constant", () => {
    const preset = getRetrievalPreset("fast")
    preset.rerank = true
    expect(RETRIEVAL_PRESETS.fast.rerank).toBe(false)
  })
})
