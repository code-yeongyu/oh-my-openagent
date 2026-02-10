import { describe, it, expect, beforeEach } from "bun:test"
import {
  initializeAgentNameAliases,
  toCanonical,
  toRegistered,
  getCanonicalToRegisteredMap,
  hasAliases,
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

describe("agent-name-aliases", () => {
  beforeEach(() => {
    resetAgentNameAliases()
  })

  describe("round-trip", () => {
    it("toRegistered(toCanonical(alias)) returns alias", () => {
      //#given sisyphus mapped to Bob
      initializeAgentNameAliases({ sisyphus: "Bob" }, ALL_CANONICAL)

      //#when round-tripping alias through canonical
      const canonical = toCanonical("Bob")
      const registered = toRegistered(canonical)

      //#then returns the alias
      expect(canonical).toBe("sisyphus")
      expect(registered).toBe("Bob")
    })

    it("toCanonical(toRegistered(canonical)) returns canonical", () => {
      //#given sisyphus mapped to Bob
      initializeAgentNameAliases({ sisyphus: "Bob" }, ALL_CANONICAL)

      //#when round-tripping canonical through registered
      const registered = toRegistered("sisyphus")
      const canonical = toCanonical(registered)

      //#then returns the canonical
      expect(registered).toBe("Bob")
      expect(canonical).toBe("sisyphus")
    })
  })

  describe("identity (no mapping)", () => {
    it("toCanonical returns canonical as-is when no alias exists", () => {
      //#given no aliases initialized
      initializeAgentNameAliases(undefined, ALL_CANONICAL)

      //#when toCanonical called with canonical name
      const result = toCanonical("sisyphus")

      //#then returns same name
      expect(result).toBe("sisyphus")
    })

    it("toRegistered returns unknown name as-is when no mapping", () => {
      //#given no aliases initialized
      initializeAgentNameAliases(undefined, ALL_CANONICAL)

      //#when toRegistered called with unknown name
      const result = toRegistered("unknown")

      //#then returns same name
      expect(result).toBe("unknown")
    })
  })

  describe("case-insensitive", () => {
    it("toCanonical resolves alias regardless of case", () => {
      //#given sisyphus mapped to Bob
      initializeAgentNameAliases({ sisyphus: "Bob" }, ALL_CANONICAL)

      //#when toCanonical called with uppercase alias
      const result = toCanonical("BOB")

      //#then returns canonical name
      expect(result).toBe("sisyphus")
    })

    it("toRegistered resolves canonical regardless of case", () => {
      //#given sisyphus mapped to Bob
      initializeAgentNameAliases({ sisyphus: "Bob" }, ALL_CANONICAL)

      //#when toRegistered called with uppercase canonical
      const result = toRegistered("SISYPHUS")

      //#then returns registered alias
      expect(result).toBe("Bob")
    })
  })

  describe("collision detection", () => {
    it("warns on duplicate alias values", () => {
      //#given two agents mapped to the same alias
      const config = { sisyphus: "Worker", hephaestus: "Worker" }

      //#when initializing
      const { warnings } = initializeAgentNameAliases(config, ALL_CANONICAL)

      //#then returns warning about collision
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain("Worker")
    })

    it("warns when alias collides with existing canonical name", () => {
      //#given sisyphus mapped to "oracle" (which is a canonical name)
      const config = { sisyphus: "oracle" }

      //#when initializing
      const { warnings } = initializeAgentNameAliases(config, ALL_CANONICAL)

      //#then returns warning about canonical collision
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain("oracle")
    })
  })

  describe("non-existent agent", () => {
    it("warns when canonical name does not exist", () => {
      //#given alias for non-existent agent
      const config = { nonexistent: "Ghost" }

      //#when initializing
      const { warnings } = initializeAgentNameAliases(config, ALL_CANONICAL)

      //#then returns warning about unknown canonical
      expect(warnings.length).toBeGreaterThan(0)
      expect(warnings[0]).toContain("nonexistent")
    })
  })

  describe("empty/undefined config", () => {
    it("hasAliases returns false with undefined config", () => {
      //#given undefined config
      initializeAgentNameAliases(undefined, ALL_CANONICAL)

      //#when checking hasAliases
      //#then returns false
      expect(hasAliases()).toBe(false)
    })

    it("hasAliases returns false with empty config", () => {
      //#given empty config
      initializeAgentNameAliases({}, ALL_CANONICAL)

      //#when checking hasAliases
      //#then returns false
      expect(hasAliases()).toBe(false)
    })
  })

  describe("multiple aliases", () => {
    it("all resolve correctly", () => {
      //#given multiple aliases
      const config = {
        sisyphus: "Bob",
        atlas: "Alice",
        oracle: "Oscar",
      }
      initializeAgentNameAliases(config, ALL_CANONICAL)

      //#when resolving each alias
      //#then all resolve to correct canonical
      expect(toCanonical("Bob")).toBe("sisyphus")
      expect(toCanonical("Alice")).toBe("atlas")
      expect(toCanonical("Oscar")).toBe("oracle")

      //#then all canonical names resolve to aliases
      expect(toRegistered("sisyphus")).toBe("Bob")
      expect(toRegistered("atlas")).toBe("Alice")
      expect(toRegistered("oracle")).toBe("Oscar")

      //#then unaliased agents remain unchanged
      expect(toRegistered("prometheus")).toBe("prometheus")
    })
  })

  describe("getCanonicalToRegisteredMap", () => {
    it("returns map of all aliases", () => {
      //#given aliases configured
      initializeAgentNameAliases({ sisyphus: "Bob", atlas: "Alice" }, ALL_CANONICAL)

      //#when getting map
      const map = getCanonicalToRegisteredMap()

      //#then map contains all aliases
      expect(map.size).toBe(2)
      expect(map.get("sisyphus")).toBe("Bob")
      expect(map.get("atlas")).toBe("Alice")
    })

    it("returns empty map when no aliases", () => {
      //#given no aliases
      initializeAgentNameAliases(undefined, ALL_CANONICAL)

      //#when getting map
      const map = getCanonicalToRegisteredMap()

      //#then map is empty
      expect(map.size).toBe(0)
    })
  })

  describe("reset", () => {
    it("clears all state", () => {
      //#given aliases configured
      initializeAgentNameAliases({ sisyphus: "Bob" }, ALL_CANONICAL)
      expect(hasAliases()).toBe(true)

      //#when reset called
      resetAgentNameAliases()

      //#then all state is cleared
      expect(hasAliases()).toBe(false)
      expect(toCanonical("Bob")).toBe("bob")
      expect(toRegistered("sisyphus")).toBe("sisyphus")
      expect(getCanonicalToRegisteredMap().size).toBe(0)
    })
  })
})
