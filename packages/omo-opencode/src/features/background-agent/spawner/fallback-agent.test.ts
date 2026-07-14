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
})
