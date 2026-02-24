import { describe, expect, test } from "bun:test"
import { applyMissingCouncilGuard } from "./athena-council-guard"
import type { AgentConfig } from "@opencode-ai/sdk"

describe("applyMissingCouncilGuard", () => {
  describe("#given an athena agent config with no skipped members", () => {
    test("#when applying the guard #then replaces prompt with missing council message", () => {
      //#given
      const athenaConfig: AgentConfig = {
        model: "anthropic/claude-opus-4-6",
        prompt: "original orchestration prompt",
        temperature: 0.1,
      }
      //#when
      const result = applyMissingCouncilGuard(athenaConfig)
      //#then
      expect(result.prompt).not.toBe("original orchestration prompt")
      expect(result.prompt).toContain("No Council Members Configured")
    })
  })

  describe("#given an athena agent config with skipped members", () => {
    test("#when applying the guard #then includes skipped member names and reasons", () => {
      //#given
      const athenaConfig: AgentConfig = {
        model: "anthropic/claude-opus-4-6",
        prompt: "original orchestration prompt",
      }
      const skippedMembers = [
        { name: "GPT", reason: "invalid model format" },
        { name: "Gemini", reason: "duplicate name" },
      ]
      //#when
      const result = applyMissingCouncilGuard(athenaConfig, skippedMembers)
      //#then
      expect(result.prompt).toContain("GPT")
      expect(result.prompt).toContain("invalid model format")
      expect(result.prompt).toContain("Gemini")
      expect(result.prompt).toContain("duplicate name")
      expect(result.prompt).toContain("Why Council Failed")
    })
  })

  describe("#given an athena agent config", () => {
    test("#when applying the guard #then preserves model and other agent properties", () => {
      //#given
      const athenaConfig: AgentConfig = {
        model: "anthropic/claude-opus-4-6",
        prompt: "original prompt",
        temperature: 0.1,
      }
      //#when
      const result = applyMissingCouncilGuard(athenaConfig)
      //#then
      expect(result.model).toBe("anthropic/claude-opus-4-6")
      expect(result.temperature).toBe(0.1)
    })

    test("#when applying the guard #then prompt includes configuration instructions", () => {
      //#given
      const athenaConfig: AgentConfig = {
        model: "anthropic/claude-opus-4-6",
        prompt: "original prompt",
      }
      //#when
      const result = applyMissingCouncilGuard(athenaConfig)
      //#then
      expect(result.prompt).toContain("oh-my-opencode")
      expect(result.prompt).toContain("council")
      expect(result.prompt).toContain("members")
    })

    test("#when applying the guard with empty skipped members array #then does not include why council failed section", () => {
      //#given
      const athenaConfig: AgentConfig = {
        model: "anthropic/claude-opus-4-6",
        prompt: "original prompt",
      }
      //#when
      const result = applyMissingCouncilGuard(athenaConfig, [])
      //#then
      expect(result.prompt).not.toContain("Why Council Failed")
    })
  })
})
