import { describe, expect, test } from "bun:test"
import { createMetisAgent, METIS_K2_7_SYSTEM_PROMPT, METIS_SYSTEM_PROMPT } from "./metis"

describe("createMetisAgent K2.7 native prompt", () => {
  test("#given a Kimi K2.7 model #then uses the from-scratch K2.7 Metis prompt", () => {
    // given
    const agent = createMetisAgent("opencode-go/kimi-k2.7")

    // then
    expect(agent.prompt).toBe(METIS_K2_7_SYSTEM_PROMPT)
    expect(agent.prompt).toContain("running on Kimi K2.7")
  })

  test("#given a k2p7 shorthand model #then uses the K2.7 Metis prompt", () => {
    // given
    const agent = createMetisAgent("kimi-for-coding/k2p7")

    // then
    expect(agent.prompt).toBe(METIS_K2_7_SYSTEM_PROMPT)
  })

  test("#given a non-K2.7 model #then uses the base prompt", () => {
    // given
    const k26 = createMetisAgent("opencode-go/kimi-k2.6")
    const sonnet = createMetisAgent("anthropic/claude-sonnet-4-6")

    // then
    expect(k26.prompt).toBe(METIS_SYSTEM_PROMPT)
    expect(sonnet.prompt).toBe(METIS_SYSTEM_PROMPT)
    expect(k26.prompt).not.toContain("running on Kimi K2.7")
  })
})
