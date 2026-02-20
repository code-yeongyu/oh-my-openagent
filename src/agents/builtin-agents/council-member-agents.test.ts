import { describe, expect, test } from "bun:test"
import { registerCouncilMemberAgents } from "./council-member-agents"

describe("council-member-agents", () => {
  test("skips case-insensitive duplicate names and disables council when below minimum", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT" },
        { model: "anthropic/claude-opus-4-6", name: "gpt" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(0)
    expect(result.agents).toEqual({})
  })

  test("registers different models without error", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT" },
        { model: "anthropic/claude-opus-4-6", name: "Claude" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(2)
    expect(result.registeredKeys).toContain("Council: GPT")
    expect(result.registeredKeys).toContain("Council: Claude")
  })

  test("allows same model with different names", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT Codex" },
        { model: "openai/gpt-5.3-codex", name: "Codex GPT" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(2)
    expect(result.agents).toHaveProperty("Council: GPT Codex")
    expect(result.agents).toHaveProperty("Council: Codex GPT")
  })

  test("returns empty when valid members below 2", () => {
    //#given - one valid model, one invalid (no slash separator)
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT" },
        { model: "invalid-no-slash", name: "Invalid" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(0)
    expect(result.agents).toEqual({})
  })
})
