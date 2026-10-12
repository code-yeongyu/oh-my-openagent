import { describe, expect, test } from "bun:test"
import { createMetisAgent } from "./metis"

describe("Metis role configuration", () => {
  test.each(["opencode-go/kimi-k2.7", "kimi-for-coding/k2p7", "moonshotai/kimi-k2.8", "kimi-for-coding/kimi-for-coding", "kimi-for-coding/kimi-for-coding-highspeed", "opencode-go/kimi-k2.6", "anthropic/claude-sonnet-4-6"])("preserves read-only role settings for %s", (model) => {
    const agent = createMetisAgent(model)
    expect(agent.model).toBe(model)
    expect(agent.mode).toBe("subagent")
    expect(agent.temperature).toBe(0.3)
    expect(agent.permission).toMatchObject({ write: "deny", edit: "deny", apply_patch: "deny" })
  })
})
