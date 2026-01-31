/**
 * Agent Chains Tests
 *
 * Tests for predefined agent collaboration sequences (Bugfix/Refactor chains)
 */

import { describe, it, expect, beforeEach } from "bun:test"
import {
  AgentChainManager,
  createAgentChainManager,
  ChainType,
  type AgentChainStep,
} from "./agent-chains"

describe("AgentChainManager", () => {
  let manager: AgentChainManager

  beforeEach(() => {
    manager = createAgentChainManager()
  })

  describe("available chains", () => {
    it("should have bugfix chain", () => {
      expect(manager.hasChain(ChainType.BUGFIX)).toBe(true)
    })

    it("should have refactor chain", () => {
      expect(manager.hasChain(ChainType.REFACTOR)).toBe(true)
    })

    it("should list all available chains", () => {
      const chains = manager.listChains()
      expect(chains).toContain(ChainType.BUGFIX)
      expect(chains).toContain(ChainType.REFACTOR)
    })
  })

  describe("bugfix chain", () => {
    //#given bugfix chain template
    //#when getting chain steps
    //#then should return correct agent sequence
    it("should have correct agent sequence", () => {
      const chain = manager.getChain(ChainType.BUGFIX)

      expect(chain.steps).toHaveLength(4)
      expect(chain.steps[0].agent).toBe("explore")
      expect(chain.steps[1].agent).toBe("oracle")
      expect(chain.steps[2].agent).toBe("implementer")
      expect(chain.steps[3].agent).toBe("verifier")
    })

    it("should have explore as first step for code discovery", () => {
      const chain = manager.getChain(ChainType.BUGFIX)
      const firstStep = chain.steps[0]

      expect(firstStep.agent).toBe("explore")
      expect(firstStep.purpose.toLowerCase()).toContain("locate")
    })

    it("should have oracle for diagnosis", () => {
      const chain = manager.getChain(ChainType.BUGFIX)
      const oracleStep = chain.steps.find((s: AgentChainStep) => s.agent === "oracle")

      expect(oracleStep).toBeDefined()
      expect(oracleStep?.purpose.toLowerCase()).toContain("diagnose")
    })

    it("should end with verification", () => {
      const chain = manager.getChain(ChainType.BUGFIX)
      const lastStep = chain.steps[chain.steps.length - 1]

      expect(lastStep.agent).toBe("verifier")
    })
  })

  describe("refactor chain", () => {
    //#given refactor chain template
    //#when getting chain steps
    //#then should return correct agent sequence
    it("should have correct agent sequence", () => {
      const chain = manager.getChain(ChainType.REFACTOR)

      expect(chain.steps).toHaveLength(4)
      expect(chain.steps[0].agent).toBe("explore")
      expect(chain.steps[1].agent).toBe("oracle")
      expect(chain.steps[2].agent).toBe("implementer")
      expect(chain.steps[3].agent).toBe("verifier")
    })

    it("should include LSP tools usage in implementer step", () => {
      const chain = manager.getChain(ChainType.REFACTOR)
      const implStep = chain.steps.find((s: AgentChainStep) => s.agent === "implementer")

      expect(implStep?.tools).toContain("lsp")
    })
  })

  describe("chain customization", () => {
    //#given custom chain configuration
    //#when merging with preset
    //#then custom steps should be included
    it("should allow adding custom steps", () => {
      const customStep: AgentChainStep = {
        agent: "custom-agent",
        purpose: "Custom validation",
        tools: [],
      }

      const chain = manager.getChainWithCustomSteps(ChainType.BUGFIX, [customStep])

      expect(chain.steps).toHaveLength(5)
      expect(chain.steps[4].agent).toBe("custom-agent")
    })

    it("should allow skipping steps", () => {
      const chain = manager.getChainWithSkippedSteps(ChainType.BUGFIX, ["oracle"])

      expect(chain.steps).toHaveLength(3)
      expect(chain.steps.find((s: AgentChainStep) => s.agent === "oracle")).toBeUndefined()
    })
  })

  describe("chain execution context", () => {
    it("should generate execution context for chain", () => {
      const context = manager.generateExecutionContext(ChainType.BUGFIX, {
        issue: "Login fails with invalid token",
        files: ["src/auth/login.ts"],
      })

      expect(context).toContain("Login fails")
      expect(context).toContain("explore")
      expect(context).toContain("oracle")
    })
  })

  describe("unknown chain handling", () => {
    it("should throw error for unknown chain", () => {
      expect(() => manager.getChain("invalid" as ChainType)).toThrow()
    })
  })
})
