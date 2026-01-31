/**
 * Role Rules Tests
 */

import { describe, test, expect } from "bun:test"
import {
  normalizeAgentRole,
  getRulesForRole,
  isMinimalRules,
  DEFAULT_ROLE_RULES_CONFIG,
} from "./role-rules"

describe("Role Rules", () => {
  describe("normalizeAgentRole", () => {
    test("should normalize oracle agent", () => {
      expect(normalizeAgentRole("oracle")).toBe("oracle")
      expect(normalizeAgentRole("Oracle")).toBe("oracle")
      expect(normalizeAgentRole("ORACLE")).toBe("oracle")
      expect(normalizeAgentRole("oracle-agent")).toBe("oracle")
    })

    test("should normalize explore agent", () => {
      expect(normalizeAgentRole("explore")).toBe("explore")
      expect(normalizeAgentRole("Explore")).toBe("explore")
      expect(normalizeAgentRole("explore-fast")).toBe("explore")
    })

    test("should normalize sisyphus agent", () => {
      expect(normalizeAgentRole("sisyphus")).toBe("sisyphus")
      expect(normalizeAgentRole("Sisyphus")).toBe("sisyphus")
      expect(normalizeAgentRole("Sisyphus-Junior")).toBe("sisyphus")
    })

    test("should normalize prometheus/planner agent", () => {
      expect(normalizeAgentRole("prometheus")).toBe("prometheus")
      expect(normalizeAgentRole("Prometheus (Planner)")).toBe("prometheus")
      expect(normalizeAgentRole("planner")).toBe("prometheus")
    })

    test("should normalize librarian agent", () => {
      expect(normalizeAgentRole("librarian")).toBe("librarian")
      expect(normalizeAgentRole("Librarian")).toBe("librarian")
    })

    test("should normalize frontend agent", () => {
      expect(normalizeAgentRole("frontend-ui-ux")).toBe("frontend-ui-ux")
      expect(normalizeAgentRole("frontend-ui-ux-engineer")).toBe("frontend-ui-ux")
      expect(normalizeAgentRole("ui-ux")).toBe("frontend-ui-ux")
    })

    test("should return default for unknown agents", () => {
      expect(normalizeAgentRole("custom-agent")).toBe("default")
      expect(normalizeAgentRole("my-special-agent")).toBe("default")
      expect(normalizeAgentRole("")).toBe("default")
    })
  })

  describe("getRulesForRole", () => {
    test("should return architecture rules for Oracle", () => {
      // #given - oracle agent
      const agentName = "oracle"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should contain architecture content
      expect(rules).toContain("Oracle Agent Guidelines")
      expect(rules).toContain("Architecture Review")
      expect(rules).toContain("Effort Estimate")
      expect(rules).toContain("One Clear Path")
    })

    test("should return minimal rules for Explore", () => {
      // #given - explore agent
      const agentName = "explore"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should be minimal (< 500 chars)
      expect(rules).toContain("Explore Agent Guidelines")
      expect(isMinimalRules(rules)).toBe(true)
    })

    test("should return full rules for Sisyphus", () => {
      // #given - sisyphus agent
      const agentName = "Sisyphus"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should contain orchestration content
      expect(rules).toContain("Sisyphus Orchestrator Guidelines")
      expect(rules).toContain("Delegate")
      expect(rules).toContain("Verify")
    })

    test("should return default rules for unknown agent", () => {
      // #given - unknown agent
      const agentName = "my-custom-agent"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should return default rules
      expect(rules).toContain("Agent Guidelines")
      expect(rules).toContain("best practices")
    })

    test("should return empty string when disabled", () => {
      // #given - disabled config
      const agentName = "oracle"
      const config = { ...DEFAULT_ROLE_RULES_CONFIG, enabled: false }

      // #when - getting rules
      const rules = getRulesForRole(agentName, config)

      // #then - should be empty
      expect(rules).toBe("")
    })

    test("should respect custom role rules", () => {
      // #given - custom rules for oracle
      const agentName = "oracle"
      const customRules = "## Custom Oracle Rules\nDo something special."
      const config = {
        ...DEFAULT_ROLE_RULES_CONFIG,
        custom_role_rules: { oracle: customRules },
      }

      // #when - getting rules
      const rules = getRulesForRole(agentName, config)

      // #then - should return custom rules
      expect(rules).toBe(customRules)
    })

    test("should return planning rules for Prometheus", () => {
      // #given - prometheus agent
      const agentName = "Prometheus (Planner)"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should contain planning content
      expect(rules).toContain("Prometheus Planner Guidelines")
      expect(rules).toContain("task breakdown")
    })

    test("should return librarian rules", () => {
      // #given - librarian agent
      const agentName = "librarian"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should contain documentation content
      expect(rules).toContain("Librarian Agent Guidelines")
      expect(rules).toContain("documentation")
    })

    test("should return frontend rules for UI agent", () => {
      // #given - frontend agent
      const agentName = "frontend-ui-ux-engineer"

      // #when - getting rules
      const rules = getRulesForRole(agentName)

      // #then - should contain frontend content
      expect(rules).toContain("Frontend UI/UX Guidelines")
      expect(rules).toContain("Responsive")
    })
  })

  describe("isMinimalRules", () => {
    test("should return true for short rules", () => {
      expect(isMinimalRules("Short rule")).toBe(true)
      expect(isMinimalRules("a".repeat(499))).toBe(true)
    })

    test("should return false for long rules", () => {
      expect(isMinimalRules("a".repeat(500))).toBe(false)
      expect(isMinimalRules("a".repeat(1000))).toBe(false)
    })

    test("should return true for explore rules", () => {
      const exploreRules = getRulesForRole("explore")
      expect(isMinimalRules(exploreRules)).toBe(true)
    })

    test("should return false for oracle rules", () => {
      const oracleRules = getRulesForRole("oracle")
      expect(isMinimalRules(oracleRules)).toBe(false)
    })
  })
})
