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
    expect(result.registeredKeys).toContain("Council: gpt")
    expect(result.registeredKeys).toContain("Council: claude")
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
    expect(result.agents).toHaveProperty("Council: gpt_codex")
    expect(result.agents).toHaveProperty("Council: codex_gpt")
  })

  test("registers solo-mode council members with finish-only runtime tool access", () => {
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
    const result = registerCouncilMemberAgents(config, "solo")
    const tools = result.agents["Council: gpt"].tools as Record<string, boolean>

    //#then
    expect(tools.finish_task).toBe(true)
    expect(tools.background_wait).toBe(true)
    expect(tools.read).toBe(true)
    expect(tools.call_omo_agent).toBe(false)
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

  test("normalizes member names with spaces to underscores", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT 5.3 Codex" },
        { model: "anthropic/claude-opus-4-6", name: "Claude Opus" },
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
    expect(result.registeredKeys).toContain("Council: gpt_5.3_codex")
    expect(result.registeredKeys).toContain("Council: claude_opus")
  })

  test("detects normalized duplicates with different spacing", () => {
    //#given
    const config = {
      members: [
        { model: "openai/gpt-5.3-codex", name: "GPT Codex" },
        { model: "anthropic/claude-opus-4-6", name: "Claude" },
        { model: "google/gemini-3-pro", name: "gpt codex" },
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
    expect(result.skippedMembers[0].name).toBe("gpt codex")
    expect(result.skippedMembers[0].reason).toContain("Duplicate name")
  })
})
