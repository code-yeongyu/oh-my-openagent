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
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
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
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
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
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
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
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(0)
    expect(result.agents).toEqual({})
  })

  test("returns skippedMembers with reason for invalid model format", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT" },
        { model: "no-slash", name: "Bad" },
        { model: "anthropic/claude-opus-4-6", name: "Claude" },
      ],
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.skippedMembers).toHaveLength(1)
    expect(result.skippedMembers[0].name).toBe("Bad")
    expect(result.skippedMembers[0].reason).toContain("Invalid model format")
    expect(result.skippedMembers[0].reason).toContain("no-slash")
  })

  test("returns skippedMembers with reason for duplicate names", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "Alpha" },
        { model: "anthropic/claude-opus-4-6", name: "Beta" },
        { model: "google/gemini-3-pro", name: "alpha" },
      ],
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.registeredKeys).toHaveLength(2)
    expect(result.skippedMembers).toHaveLength(1)
    expect(result.skippedMembers[0].name).toBe("alpha")
    expect(result.skippedMembers[0].reason).toContain("Duplicate name")
  })

  test("returns skippedMembers combining both invalid model and duplicate reasons", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT" },
        { model: "bad-model", name: "Invalid" },
        { model: "anthropic/claude-opus-4-6", name: "Claude" },
        { model: "google/gemini-3-pro", name: "gpt" },
      ],
      retry_on_fail: 0,
      retry_failed_if_others_finished: false,
      cancel_retrying_on_quorum: true,
      stuck_threshold_seconds: 120,
      member_max_running_seconds: 1800,
    }
    //#when
    const result = registerCouncilMemberAgents(config)
    //#then
    expect(result.skippedMembers).toHaveLength(2)
    expect(result.skippedMembers[0].name).toBe("Invalid")
    expect(result.skippedMembers[0].reason).toContain("Invalid model format")
    expect(result.skippedMembers[1].name).toBe("gpt")
    expect(result.skippedMembers[1].reason).toContain("Duplicate name")
  })
})
