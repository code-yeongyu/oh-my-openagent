/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { registerAndConfigureAthenaCouncil } from "./helpers"
import { createAthenaAgent } from "./agent"
import { createAthenaJuniorAgent } from "./athena-junior-agent"
import type { CouncilConfig } from "../../config/schema/athena"

describe("registerAndConfigureAthenaCouncil", () => {
  const mockCouncilConfig: CouncilConfig = {
    members: [
      { name: "Claude Opus 4.6", model: "anthropic/claude-opus-4-6" },
      { name: "Claude Sonnet 4", model: "anthropic/claude-sonnet-4" },
    ],
  }

  describe("#given Athena and Athena-Junior agents with council config", () => {
    describe("#when registering council members", () => {
      it("#then Athena prompt contains 'Council: ' prefixed member names", () => {
        const agents = {
          athena: createAthenaAgent("anthropic/claude-opus-4-6"),
          "athena-junior": createAthenaJuniorAgent("anthropic/claude-opus-4-6"),
        }

        const result = registerAndConfigureAthenaCouncil(agents, mockCouncilConfig)

        const athenaPrompt = result["athena"].prompt ?? ""
        expect(athenaPrompt).toContain("Council: Claude Opus 4.6")
        expect(athenaPrompt).toContain("Council: Claude Sonnet 4")
      })

      it("#then Athena-Junior prompt contains 'Athena-Junior Council: ' prefixed member names", () => {
        const agents = {
          athena: createAthenaAgent("anthropic/claude-opus-4-6"),
          "athena-junior": createAthenaJuniorAgent("anthropic/claude-opus-4-6"),
        }

        const result = registerAndConfigureAthenaCouncil(agents, mockCouncilConfig)

        const juniorPrompt = result["athena-junior"].prompt ?? ""
        expect(juniorPrompt).toContain("Athena-Junior Council: Claude Opus 4.6")
        expect(juniorPrompt).toContain("Athena-Junior Council: Claude Sonnet 4")
      })

      it("#then Athena-Junior prompt does NOT contain 'Council: ' prefix (without Athena-Junior)", () => {
        const agents = {
          athena: createAthenaAgent("anthropic/claude-opus-4-6"),
          "athena-junior": createAthenaJuniorAgent("anthropic/claude-opus-4-6"),
        }

        const result = registerAndConfigureAthenaCouncil(agents, mockCouncilConfig)

        const juniorPrompt = result["athena-junior"].prompt ?? ""
        // Should NOT contain the regular "Council: " prefix
        expect(juniorPrompt).not.toContain("- \"Council: Claude Opus 4.6\"")
        expect(juniorPrompt).not.toContain("- \"Council: Claude Sonnet 4\"")
      })

      it("#then Athena prompt still contains 'Council: ' prefix (unchanged)", () => {
        const agents = {
          athena: createAthenaAgent("anthropic/claude-opus-4-6"),
          "athena-junior": createAthenaJuniorAgent("anthropic/claude-opus-4-6"),
        }

        const result = registerAndConfigureAthenaCouncil(agents, mockCouncilConfig)

        const athenaPrompt = result["athena"].prompt ?? ""
        // Should contain the regular "Council: " prefix
        expect(athenaPrompt).toContain("- \"Council: Claude Opus 4.6\"")
        expect(athenaPrompt).toContain("- \"Council: Claude Sonnet 4\"")
      })
    })
  })
})
