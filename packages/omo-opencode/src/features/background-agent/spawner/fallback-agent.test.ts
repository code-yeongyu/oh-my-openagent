import { describe, expect, test } from "bun:test"
import { buildFallbackBody } from "./fallback-agent"

describe("buildFallbackBody", () => {
  test("disables call_omo_agent for an Anthropic-backed fallback", () => {
    //#given
    const originalBody = {
      model: { providerID: "anthropic", modelID: "claude-sonnet-4-6" },
      tools: { task: false, call_omo_agent: true, question: false },
    }

    //#when
    const fallbackBody = buildFallbackBody(originalBody, "general")

    //#then
    expect(fallbackBody.tools.call_omo_agent).toBe(false)
  })

  test("keeps call_omo_agent enabled for a non-Anthropic fallback", () => {
    //#given
    const originalBody = {
      model: { providerID: "openai", modelID: "gpt-5.4" },
      tools: { task: false, call_omo_agent: true, question: false },
    }

    //#when
    const fallbackBody = buildFallbackBody(originalBody, "general")

    //#then
    expect(fallbackBody.tools.call_omo_agent).toBe(true)
  })

  test("preserves a disabled inherited-provider policy during fallback", () => {
    //#given
    const originalBody = {
      tools: { task: false, call_omo_agent: false, question: false },
    }

    //#when
    const fallbackBody = buildFallbackBody(originalBody, "general")

    //#then
    expect(fallbackBody.tools.call_omo_agent).toBe(false)
  })
})
