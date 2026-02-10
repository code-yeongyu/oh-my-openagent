import { describe, it, expect, beforeEach } from "bun:test"
import {
  getAgentToolRestrictions,
  hasAgentToolRestrictions,
} from "./agent-tool-restrictions"
import {
  initializeAgentNameAliases,
  resetAgentNameAliases,
} from "./agent-name-aliases"

const ALL_CANONICAL = [
  "sisyphus",
  "atlas",
  "prometheus",
  "sisyphus-junior",
  "metis",
  "momus",
  "oracle",
  "librarian",
  "explore",
  "multimodal-looker",
  "hephaestus",
]

describe("agent-tool-restrictions", () => {
  beforeEach(() => {
    resetAgentNameAliases()
  })

  describe("getAgentToolRestrictions", () => {
    it("returns restrictions for canonical agent name", () => {
      //#given explore agent has restrictions
      const restrictions = getAgentToolRestrictions("explore")

      //#then returns the exploration denylist
      expect(restrictions).toEqual({
        write: false,
        edit: false,
        task: false,
        call_omo_agent: false,
      })
    })

    it("returns restrictions for custom alias when mapped", () => {
      //#given explore mapped to Scout
      initializeAgentNameAliases({ explore: "Scout" }, ALL_CANONICAL)

      //#when getting restrictions for Scout
      const restrictions = getAgentToolRestrictions("Scout")

      //#then returns explore's restrictions
      expect(restrictions).toEqual({
        write: false,
        edit: false,
        task: false,
        call_omo_agent: false,
      })
    })

    it("returns empty object for unknown agent", () => {
      //#given unknown agent name
      const restrictions = getAgentToolRestrictions("unknown-agent")

      //#then returns empty object
      expect(restrictions).toEqual({})
    })

    it("handles case-insensitive lookup for canonical names", () => {
      //#given explore agent
      const restrictionsLower = getAgentToolRestrictions("explore")
      const restrictionsUpper = getAgentToolRestrictions("EXPLORE")

      //#then both return same restrictions
      expect(restrictionsLower).toEqual(restrictionsUpper)
    })
  })

  describe("hasAgentToolRestrictions", () => {
    it("returns true for agent with restrictions", () => {
      //#given explore agent has restrictions
      const has = hasAgentToolRestrictions("explore")

      //#then returns true
      expect(has).toBe(true)
    })

    it("returns true for custom alias with restrictions", () => {
      //#given explore mapped to Scout
      initializeAgentNameAliases({ explore: "Scout" }, ALL_CANONICAL)

      //#when checking Scout
      const has = hasAgentToolRestrictions("Scout")

      //#then returns true
      expect(has).toBe(true)
    })

    it("returns false for unknown agent", () => {
      //#given unknown agent name
      const has = hasAgentToolRestrictions("unknown-agent")

      //#then returns false
      expect(has).toBe(false)
    })

    it("returns false for agent without restrictions", () => {
      //#given sisyphus agent (no restrictions defined)
      const has = hasAgentToolRestrictions("sisyphus")

      //#then returns false
      expect(has).toBe(false)
    })
  })
})
