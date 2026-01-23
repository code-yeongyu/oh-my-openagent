import { describe, expect, it } from "bun:test"
import { includesCaseInsensitive } from "./shared"

/**
 * Tests for conditional tool registration logic in index.ts
 * 
 * The actual plugin initialization is complex to test directly,
 * so we test the underlying logic that determines tool registration.
 */
describe("look_at tool conditional registration", () => {
  describe("isMultimodalLookerEnabled logic", () => {
    // #given multimodal-looker is in disabled_agents
    // #when checking if agent is enabled
    // #then should return false (disabled)
    it("returns false when multimodal-looker is disabled (exact case)", () => {
      const disabledAgents = ["multimodal-looker"]
      const isEnabled = !includesCaseInsensitive(disabledAgents, "multimodal-looker")
      expect(isEnabled).toBe(false)
    })

    // #given multimodal-looker is in disabled_agents with different case
    // #when checking if agent is enabled
    // #then should return false (case-insensitive match)
    it("returns false when multimodal-looker is disabled (case-insensitive)", () => {
      const disabledAgents = ["Multimodal-Looker"]
      const isEnabled = !includesCaseInsensitive(disabledAgents, "multimodal-looker")
      expect(isEnabled).toBe(false)
    })

    // #given multimodal-looker is NOT in disabled_agents
    // #when checking if agent is enabled
    // #then should return true (enabled)
    it("returns true when multimodal-looker is not disabled", () => {
      const disabledAgents = ["oracle", "librarian"]
      const isEnabled = !includesCaseInsensitive(disabledAgents, "multimodal-looker")
      expect(isEnabled).toBe(true)
    })

    // #given disabled_agents is empty
    // #when checking if agent is enabled
    // #then should return true (enabled by default)
    it("returns true when disabled_agents is empty", () => {
      const disabledAgents: string[] = []
      const isEnabled = !includesCaseInsensitive(disabledAgents, "multimodal-looker")
      expect(isEnabled).toBe(true)
    })

    // #given disabled_agents is undefined (simulated as empty array)
    // #when checking if agent is enabled
    // #then should return true (enabled by default)
    it("returns true when disabled_agents is undefined (fallback to empty)", () => {
      const disabledAgents = undefined
      const isEnabled = !includesCaseInsensitive(disabledAgents ?? [], "multimodal-looker")
      expect(isEnabled).toBe(true)
    })
  })

  describe("conditional tool spread pattern", () => {
    // #given lookAt is not null (agent enabled)
    // #when spreading into tool object
    // #then look_at should be included
    it("includes look_at when lookAt is not null", () => {
      const lookAt = { execute: () => {} } // mock tool
      const tools = {
        ...(lookAt ? { look_at: lookAt } : {}),
      }
      expect(tools).toHaveProperty("look_at")
    })

    // #given lookAt is null (agent disabled)
    // #when spreading into tool object
    // #then look_at should NOT be included
    it("excludes look_at when lookAt is null", () => {
      const lookAt = null
      const tools = {
        ...(lookAt ? { look_at: lookAt } : {}),
      }
      expect(tools).not.toHaveProperty("look_at")
    })
  })
})
