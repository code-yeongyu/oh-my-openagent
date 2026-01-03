import { describe, test, expect } from "bun:test"
import { createBuiltinAgents } from "./utils"

describe("Enterprise agents model switching", () => {
  // #region Claude Sonnet default agents (no reasoningEffort)
  describe("knowledge-curator agent", () => {
    test("default model is Claude Sonnet", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then knowledge-curator uses Claude Sonnet by default
      expect(agents["knowledge-curator"].model).toBe("anthropic/claude-sonnet-4-5")
      expect(agents["knowledge-curator"].reasoningEffort).toBeUndefined()
      expect(agents["knowledge-curator"].thinking).toBeUndefined()
    })

    test("GPT model override adds reasoningEffort", () => {
      // #given GPT model override
      const agents = createBuiltinAgents([], {
        "knowledge-curator": { model: "openai/gpt-5.2" },
      })

      // #then uses GPT with reasoningEffort
      expect(agents["knowledge-curator"].model).toBe("openai/gpt-5.2")
      expect(agents["knowledge-curator"].reasoningEffort).toBeUndefined() // no auto-add
    })
  })

  describe("project-manager agent", () => {
    test("default model is Claude Sonnet", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then project-manager uses Claude Sonnet by default
      expect(agents["project-manager"].model).toBe("anthropic/claude-sonnet-4-5")
      expect(agents["project-manager"].reasoningEffort).toBeUndefined()
    })
  })

  describe("test-engineer agent", () => {
    test("default model is Claude Sonnet", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then test-engineer uses Claude Sonnet by default
      expect(agents["test-engineer"].model).toBe("anthropic/claude-sonnet-4-5")
      expect(agents["test-engineer"].reasoningEffort).toBeUndefined()
    })
  })

  describe("code-indexer agent", () => {
    test("default model is Claude Sonnet", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then code-indexer uses Claude Sonnet by default
      expect(agents["code-indexer"].model).toBe("anthropic/claude-sonnet-4-5")
      expect(agents["code-indexer"].reasoningEffort).toBeUndefined()
    })
  })
  // #endregion

  // #region GPT default agents with medium reasoningEffort
  describe("debugger agent", () => {
    test("default model is GPT with medium reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then debugger uses GPT with medium reasoningEffort
      expect(agents["debugger"].model).toBe("openai/gpt-5.2")
      expect(agents["debugger"].reasoningEffort).toBe("medium")
    })

    test("Claude model override switches to thinking mode", () => {
      // #given Claude model override
      const agents = createBuiltinAgents([], {
        "debugger": { model: "anthropic/claude-opus-4" },
      })

      // #then switches to thinking mode
      expect(agents["debugger"].thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      })
    })
  })

  describe("devops-engineer agent", () => {
    test("default model is GPT with medium reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then devops-engineer uses GPT with medium reasoningEffort
      expect(agents["devops-engineer"].model).toBe("openai/gpt-5.2")
      expect(agents["devops-engineer"].reasoningEffort).toBe("medium")
    })
  })

  describe("api-designer agent", () => {
    test("default model is GPT with medium reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then api-designer uses GPT with medium reasoningEffort
      expect(agents["api-designer"].model).toBe("openai/gpt-5.2")
      expect(agents["api-designer"].reasoningEffort).toBe("medium")
    })
  })
  // #endregion

  // #region GPT default agents with high reasoningEffort
  describe("code-reviewer agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then code-reviewer uses GPT with high reasoningEffort
      expect(agents["code-reviewer"].model).toBe("openai/gpt-5.2")
      expect(agents["code-reviewer"].reasoningEffort).toBe("high")
    })
  })

  describe("incident-commander agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then incident-commander uses GPT with high reasoningEffort
      expect(agents["incident-commander"].model).toBe("openai/gpt-5.2")
      expect(agents["incident-commander"].reasoningEffort).toBe("high")
    })
  })

  describe("security-reviewer agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then security-reviewer uses GPT with high reasoningEffort
      expect(agents["security-reviewer"].model).toBe("openai/gpt-5.2")
      expect(agents["security-reviewer"].reasoningEffort).toBe("high")
    })
  })

  describe("performance-analyst agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then performance-analyst uses GPT with high reasoningEffort
      expect(agents["performance-analyst"].model).toBe("openai/gpt-5.2")
      expect(agents["performance-analyst"].reasoningEffort).toBe("high")
    })
  })

  describe("dba agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then dba uses GPT with high reasoningEffort
      expect(agents["dba"].model).toBe("openai/gpt-5.2")
      expect(agents["dba"].reasoningEffort).toBe("high")
    })

    test("Claude model override switches to thinking mode", () => {
      // #given Claude model override
      const agents = createBuiltinAgents([], {
        "dba": { model: "anthropic/claude-sonnet-4-5" },
      })

      // #then switches to thinking mode
      expect(agents["dba"].model).toBe("anthropic/claude-sonnet-4-5")
      expect(agents["dba"].thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      })
      expect(agents["dba"].reasoningEffort).toBeUndefined()
    })
  })

  describe("estimator agent", () => {
    test("default model is GPT with high reasoningEffort", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #then estimator uses GPT with high reasoningEffort
      expect(agents["estimator"].model).toBe("openai/gpt-5.2")
      expect(agents["estimator"].reasoningEffort).toBe("high")
    })

    test("Claude model override switches to thinking mode", () => {
      // #given Claude model override
      const agents = createBuiltinAgents([], {
        "estimator": { model: "anthropic/claude-opus-4-5" },
      })

      // #then switches to thinking mode
      expect(agents["estimator"].model).toBe("anthropic/claude-opus-4-5")
      expect(agents["estimator"].thinking).toEqual({
        type: "enabled",
        budgetTokens: 32000,
      })
    })
  })
  // #endregion

  // #region Disabled agents
  describe("disabled agents", () => {
    test("disabled enterprise agents are not created", () => {
      // #given disabled agents list
      const agents = createBuiltinAgents([
        "knowledge-curator",
        "debugger",
        "devops-engineer",
        "dba",
        "estimator",
      ])

      // #then disabled agents are not present
      expect(agents["knowledge-curator"]).toBeUndefined()
      expect(agents["debugger"]).toBeUndefined()
      expect(agents["devops-engineer"]).toBeUndefined()
      expect(agents["dba"]).toBeUndefined()
      expect(agents["estimator"]).toBeUndefined()
    })
  })
  // #endregion

  // #region Agent properties
  describe("agent descriptions", () => {
    test("all enterprise agents have descriptions", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #when checking enterprise agents
      const enterpriseAgents = [
        "knowledge-curator",
        "debugger",
        "devops-engineer",
        "project-manager",
        "test-engineer",
        "code-reviewer",
        "incident-commander",
        "security-reviewer",
        "code-indexer",
        "performance-analyst",
        "api-designer",
        "dba",
        "estimator",
      ]

      // #then all have descriptions
      for (const name of enterpriseAgents) {
        expect(agents[name].description).toBeDefined()
        expect(agents[name].description!.length).toBeGreaterThan(10)
      }
    })
  })

  describe("agent modes", () => {
    test("all enterprise agents are subagents", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #when checking enterprise agents
      const enterpriseAgents = [
        "knowledge-curator",
        "debugger",
        "devops-engineer",
        "project-manager",
        "test-engineer",
        "code-reviewer",
        "incident-commander",
        "security-reviewer",
        "code-indexer",
        "performance-analyst",
        "api-designer",
        "dba",
        "estimator",
      ]

      // #then all are subagents
      for (const name of enterpriseAgents) {
        expect(agents[name].mode).toBe("subagent")
      }
    })
  })

  describe("agent temperature", () => {
    test("all enterprise agents have low temperature", () => {
      // #given default agents
      const agents = createBuiltinAgents()

      // #when checking enterprise agents
      const enterpriseAgents = [
        "knowledge-curator",
        "debugger",
        "devops-engineer",
        "project-manager",
        "test-engineer",
        "code-reviewer",
        "incident-commander",
        "security-reviewer",
        "code-indexer",
        "performance-analyst",
        "api-designer",
        "dba",
        "estimator",
      ]

      // #then all have low temperature
      for (const name of enterpriseAgents) {
        expect(agents[name].temperature).toBeLessThanOrEqual(0.3)
      }
    })
  })
  // #endregion
})
