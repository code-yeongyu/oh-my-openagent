import { describe, expect, test } from "bun:test"
import {
  canUseCallOmoAgent,
  canonicalizeProviderID,
  resolveEffectiveProviderModel,
} from "./delegated-agent-tool-policy"

const anthropic = { providerID: "anthropic", modelID: "claude-sonnet-4-6" }
const openai = { providerID: "openai", modelID: "gpt-5.4" }

describe("delegated agent tool policy", () => {
  test("canonicalizes provider identifiers before applying policy", () => {
    expect(canonicalizeProviderID("  Anthropic  ")).toBe("anthropic")
  })

  test("prefers the explicitly resolved child model", () => {
    expect(resolveEffectiveProviderModel(openai, anthropic)).toEqual(openai)
    expect(canUseCallOmoAgent(openai, anthropic)).toBe(true)
  })

  test("uses the inherited parent model when the child model is omitted", () => {
    expect(resolveEffectiveProviderModel(undefined, anthropic)).toEqual(anthropic)
    expect(canUseCallOmoAgent(undefined, anthropic)).toBe(false)
    expect(canUseCallOmoAgent(undefined, openai)).toBe(true)
  })

  test("allows nested delegation when neither route has resolved a provider", () => {
    expect(canUseCallOmoAgent(undefined, undefined)).toBe(true)
  })
})
