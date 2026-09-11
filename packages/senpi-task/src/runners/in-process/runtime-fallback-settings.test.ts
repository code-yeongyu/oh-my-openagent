import { describe, expect, test } from "bun:test"

import type { ResolvedModelRecord } from "../../state"
import { createRuntimeFallbackSettings } from "./runtime-fallback-settings"

describe("createRuntimeFallbackSettings", () => {
  test("#given no child fallback chain #when settings are created #then global model fallback is disabled", () => {
    // given / when
    const settings = createRuntimeFallbackSettings("vendor/primary", undefined)

    // then
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: false,
      chains: {},
    })
  })

  test("#given an explicit child fallback chain #when settings are created #then only that chain is enabled", () => {
    // given / when
    const fallback: ResolvedModelRecord = {
      provider: "vendor",
      model_id: "fallback",
      display: "vendor/fallback",
      source: "category",
    }
    const settings = createRuntimeFallbackSettings("vendor/primary", [fallback])

    // then
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: {
        "vendor/primary": ["vendor/fallback"],
      },
    })
  })

  test("#given a child retry budget beside the chain #when settings are created #then the same-model budget is overridden and the chain stays enabled", () => {
    // given / when
    const fallback: ResolvedModelRecord = {
      provider: "vendor",
      model_id: "fallback",
      display: "vendor/fallback",
      source: "category",
    }
    const settings = createRuntimeFallbackSettings("vendor/primary", [fallback], { maxRetries: 1 })

    // then
    expect(settings.getRetrySettings()).toMatchObject({ maxRetries: 1 })
    expect(settings.getRetryFallbackSettings()).toMatchObject({
      modelFallback: true,
      chains: {
        "vendor/primary": ["vendor/fallback"],
      },
    })
  })
})
