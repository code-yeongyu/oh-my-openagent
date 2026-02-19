import { describe, expect, test } from "bun:test"
import { registerCouncilMemberAgents } from "./council-member-agents"

describe("council-member-agents", () => {
  test("throws on duplicate model without name", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex" },
        { model: "openai/gpt-5.3-codex" },
      ],
    }
    //#when + #then
    expect(() => registerCouncilMemberAgents(config)).toThrow("already registered")
  })

  test("registers different models without error", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex" },
        { model: "anthropic/claude-opus-4-6" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(2)
    expect(result.registeredKeys).toContain("Council: GPT 5.3 Codex")
    expect(result.registeredKeys).toContain("Council: Claude Opus 4.6")
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
        { model: "openai/gpt-5.3-codex" },
        { model: "invalid-no-slash" },
      ],
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(0)
    expect(result.agents).toEqual({})
  })
})
