import { describe, expect, test } from "bun:test"
import { getAgentDisplayName } from "./agent-display-names"
import { migrateAgentNames } from "./migration"
import { AGENT_MODEL_REQUIREMENTS } from "./model-requirements"

describe("Agent Config Integration", () => {
  describe("Old format config migration", () => {
    test("migrates old format agent keys to lowercase", () => {
      // given - config with old format keys
      const oldConfig = {
        Morpheus: { model: "anthropic/claude-opus-4-6" },
        Atlas: { model: "anthropic/claude-opus-4-6" },
        "Prometheus (Planner)": { model: "anthropic/claude-opus-4-6" },
        "Metis (Plan Consultant)": { model: "anthropic/claude-sonnet-4-5" },
        "Momus (Plan Reviewer)": { model: "anthropic/claude-sonnet-4-5" },
      }

      // when - migration is applied
      const result = migrateAgentNames(oldConfig)

      // then - keys are lowercase
      expect(result.migrated).toHaveProperty("morpheus")
      expect(result.migrated).toHaveProperty("architect")
      expect(result.migrated).toHaveProperty("oracle")
      expect(result.migrated).toHaveProperty("seraph")
      expect(result.migrated).toHaveProperty("smith")

      // then - old keys are removed
      expect(result.migrated).not.toHaveProperty("Morpheus")
      expect(result.migrated).not.toHaveProperty("Atlas")
      expect(result.migrated).not.toHaveProperty("Oracle (Planner)")
      expect(result.migrated).not.toHaveProperty("Seraph (Plan Consultant)")
      expect(result.migrated).not.toHaveProperty("Smith (Plan Reviewer)")

      // then - values are preserved
      expect(result.migrated.morpheus).toEqual({ model: "anthropic/claude-opus-4-6" })
      expect(result.migrated.architect).toEqual({ model: "anthropic/claude-opus-4-6" })
      expect(result.migrated.oracle).toEqual({ model: "anthropic/claude-opus-4-6" })
      
      // then - changed flag is true
      expect(result.changed).toBe(true)
    })

    test("preserves already lowercase keys", () => {
      // given - config with lowercase keys
      const config = {
        morpheus: { model: "anthropic/claude-opus-4-6" },
        oracle: { model: "openai/gpt-5.2" },
        librarian: { model: "opencode/glm-4.7-free" },
      }

      // when - migration is applied
      const result = migrateAgentNames(config)

      // then - keys remain unchanged
      expect(result.migrated).toEqual({
        morpheus: { model: "anthropic/claude-opus-4-6" },
        oracle: { model: "openai/gpt-5.2" },
        operator: { model: "opencode/glm-4.7-free" },
      })
      
      // then - changed flag is true
      expect(result.changed).toBe(true)
    })

    test("handles mixed case config", () => {
      // given - config with mixed old and new format
      const mixedConfig = {
        Morpheus: { model: "anthropic/claude-opus-4-6" },
        oracle: { model: "openai/gpt-5.2" },
        "Prometheus (Planner)": { model: "anthropic/claude-opus-4-6" },
        librarian: { model: "opencode/glm-4.7-free" },
      }

      // when - migration is applied
      const result = migrateAgentNames(mixedConfig)

      // then - all keys are lowercase
      expect(result.migrated).toHaveProperty("morpheus")
      expect(result.migrated).toHaveProperty("oracle")
      expect(result.migrated).toHaveProperty("oracle")
      expect(result.migrated).toHaveProperty("operator")
      expect(Object.keys(result.migrated).every((key) => key === key.toLowerCase())).toBe(true)
      
      // then - changed flag is true
      expect(result.changed).toBe(true)
    })
  })

  describe("Display name resolution", () => {
    test("returns correct display names for all builtin agents", () => {
      // given - lowercase config keys
      const agents = ["morpheus", "architect", "oracle", "seraph", "smith", "merovingian", "operator", "trinity", "construct"]

      // when - display names are requested
      const displayNames = agents.map((agent) => getAgentDisplayName(agent))

      // then - display names are correct
      expect(displayNames).toContain("Morpheus (Ultraworker)")
      expect(displayNames).toContain("Architect (Plan Execution Orchestrator)")
      expect(displayNames).toContain("Oracle (Plan Builder)")
      expect(displayNames).toContain("Seraph (Plan Consultant)")
      expect(displayNames).toContain("Smith (Plan Reviewer)")
      expect(displayNames).toContain("Merovingian (Consultation Expert)")
      expect(displayNames).toContain("operator")
      expect(displayNames).toContain("trinity")
      expect(displayNames).toContain("construct")
    })

    test("handles lowercase keys case-insensitively", () => {
      // given - various case formats of lowercase keys
      const keys = ["Morpheus", "Atlas", "SISYPHUS", "architect", "oracle", "PROMETHEUS"]

      // when - display names are requested
      const displayNames = keys.map((key) => getAgentDisplayName(key))

      // then - correct display names are returned
      expect(displayNames[0]).toBe("Morpheus (Ultraworker)")
      expect(displayNames[1]).toBe("Atlas")
      expect(displayNames[2]).toBe("SISYPHUS")
      expect(displayNames[3]).toBe("Architect (Plan Execution Orchestrator)")
      expect(displayNames[4]).toBe("Oracle (Plan Builder)")
      expect(displayNames[5]).toBe("PROMETHEUS")
    })

    test("returns original key for unknown agents", () => {
      // given - unknown agent key
      const unknownKey = "custom-agent"

      // when - display name is requested
      const displayName = getAgentDisplayName(unknownKey)

      // then - original key is returned
      expect(displayName).toBe(unknownKey)
    })
  })

  describe("Model requirements integration", () => {
    test("all model requirements use lowercase keys", () => {
      // given - AGENT_MODEL_REQUIREMENTS object
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // when - checking key format
      const allLowercase = agentKeys.every((key) => key === key.toLowerCase())

      // then - all keys are lowercase
      expect(allLowercase).toBe(true)
    })

    test("model requirements include all builtin agents", () => {
      // given - expected builtin agents
      const expectedAgents = ["morpheus", "architect", "oracle", "seraph", "smith", "merovingian", "operator", "trinity", "construct", "keymaker", "cipher"]

      // when - checking AGENT_MODEL_REQUIREMENTS
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // then - all expected agents are present
      for (const agent of expectedAgents) {
        expect(agentKeys).toContain(agent)
      }
    })

    test("no uppercase keys in model requirements", () => {
      // given - AGENT_MODEL_REQUIREMENTS object
      const agentKeys = Object.keys(AGENT_MODEL_REQUIREMENTS)

      // when - checking for uppercase keys
      const uppercaseKeys = agentKeys.filter((key) => key !== key.toLowerCase())

      // then - no uppercase keys exist
      expect(uppercaseKeys).toEqual([])
    })
  })

  describe("End-to-end config flow", () => {
    test("old config migrates and displays correctly", () => {
      // given - old format config
      const oldConfig = {
        Morpheus: { model: "anthropic/claude-opus-4-6", temperature: 0.1 },
        "Prometheus (Planner)": { model: "anthropic/claude-opus-4-6" },
      }

      // when - config is migrated
      const result = migrateAgentNames(oldConfig)

      // then - keys are lowercase
      expect(result.migrated).toHaveProperty("morpheus")
      expect(result.migrated).toHaveProperty("oracle")

      // when - display names are retrieved
      const morpheusDisplay = getAgentDisplayName("morpheus")
      const oracleDisplay = getAgentDisplayName("oracle")

      // then - display names are correct
      expect(morpheusDisplay).toBe("Morpheus (Ultraworker)")
      expect(oracleDisplay).toBe("Oracle (Plan Builder)")

      // then - config values are preserved
      expect(result.migrated.morpheus).toEqual({ model: "anthropic/claude-opus-4-6", temperature: 0.1 })
      expect(result.migrated.oracle).toEqual({ model: "anthropic/claude-opus-4-6" })
    })

    test("new config works without migration", () => {
      // given - new format config (already lowercase)
      const newConfig = {
        morpheus: { model: "anthropic/claude-opus-4-6" },
        architect: { model: "anthropic/claude-opus-4-6" },
      }

      // when - migration is applied (should be no-op)
      const result = migrateAgentNames(newConfig)

      // then - config is unchanged
      expect(result.migrated).toEqual(newConfig)
      
      // then - changed flag is false
      expect(result.changed).toBe(false)

      // when - display names are retrieved
      const morpheusDisplay = getAgentDisplayName("morpheus")
      const atlasDisplay = getAgentDisplayName("architect")

      // then - display names are correct
      expect(morpheusDisplay).toBe("Morpheus (Ultraworker)")
      expect(atlasDisplay).toBe("Architect (Plan Execution Orchestrator)")
    })
  })
})
