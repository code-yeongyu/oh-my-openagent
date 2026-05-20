import { describe, test, expect } from "bun:test"
import { createMultimodalLookerAgent } from "./multimodal-looker"

describe("createMultimodalLookerAgent", () => {
  test("prompt explicitly enumerates the agent's available tools to prevent death loop on small VL models", () => {
    // given
    const agent = createMultimodalLookerAgent("openai/gpt-5-nano")

    // when
    const prompt = typeof agent.prompt === "string" ? agent.prompt : ""

    // then
    expect(prompt).toMatch(/available tools/i)
    expect(prompt).toContain("read")
  })

  test("prompt instructs the agent never to call other tools", () => {
    // given
    const agent = createMultimodalLookerAgent("openai/gpt-5-nano")

    // when
    const prompt = typeof agent.prompt === "string" ? agent.prompt : ""

    // then
    expect(prompt.toLowerCase()).toContain("never")
  })
})
