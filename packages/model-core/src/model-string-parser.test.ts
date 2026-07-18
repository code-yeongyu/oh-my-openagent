import { describe, expect, test } from "bun:test"

import { parseModelString, parseVariantFromModelID } from "./model-string-parser"

describe("model string parser", () => {
  test("#given parenthesized variant syntax #when parsing a model ID #then variant is normalized to lowercase", () => {
    expect(parseVariantFromModelID("gpt-5.4(HIGH)")).toEqual({
      modelID: "gpt-5.4",
      variant: "high",
    })
  })

  test("#given parenthesized variant syntax #when parsing provider model string #then variant is normalized to lowercase", () => {
    expect(parseModelString("openai/gpt-5.4(XHIGH)")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "xhigh",
    })
  })

  test("#given space variant syntax #when parsing provider model string #then existing lowercase behavior remains unchanged", () => {
    expect(parseModelString("openai/gpt-5.4 HIGH")).toEqual({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "high",
    })
  })
})
