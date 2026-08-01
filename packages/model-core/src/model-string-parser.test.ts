import { describe, expect, test } from "bun:test"
import { parseModelString } from "./model-string-parser"

describe("parseModelString reasoning suffixes", () => {
  test("given provider-prefixed max suffix when parsed then it extracts the level", () => {
    expect(parseModelString("openai/gpt-5.6-sol:max")).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "max" })
  })

  test("given provider-prefixed high suffix when parsed then it extracts the level", () => {
    expect(parseModelString("anthropic/claude-fable-5:high")).toEqual({ providerID: "anthropic", modelID: "claude-fable-5", variant: "high" })
  })

  test("given non-level colon suffix when parsed then it stays part of the model id", () => {
    expect(parseModelString("openrouter/openai/gpt:free")).toEqual({ providerID: "openrouter", modelID: "openai/gpt:free" })
  })

  test("given legacy paren and space syntaxes when parsed then they still extract the variant", () => {
    expect(parseModelString("anthropic/claude-opus-4-8(xhigh)")).toEqual({ providerID: "anthropic", modelID: "claude-opus-4-8", variant: "xhigh" })
    expect(parseModelString("openai/gpt-5.6-sol high")).toEqual({ providerID: "openai", modelID: "gpt-5.6-sol", variant: "high" })
  })
})
