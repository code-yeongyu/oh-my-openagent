import { describe, expect, test } from "bun:test"

import {
  buildFallbackChainFromModels,
  parseFallbackModelEntry,
} from "./fallback-chain-from-models"

describe("fallback chain model parsing", () => {
  test("#given parenthesized variant syntax #when parsing fallback model entry #then variant is normalized to lowercase", () => {
    expect(parseFallbackModelEntry("openai/gpt-5.5(HIGH)", undefined)).toEqual({
      providers: ["openai"],
      model: "gpt-5.5",
      variant: "high",
    })
  })

  test("#given fallback model list with parenthesized variant #when building chain #then variant is normalized to lowercase", () => {
    expect(buildFallbackChainFromModels(["openai/gpt-5.5(XHIGH)"], undefined)).toEqual([
      {
        providers: ["openai"],
        model: "gpt-5.5",
        variant: "xhigh",
      },
    ])
  })
})
