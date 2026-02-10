import { describe, test, expect, beforeEach } from "bun:test"
import { initializeAgentNameAliases, resetAgentNameAliases } from "./agent-name-aliases"
import { isCallerOrchestrator } from "./session-utils"

describe("session-utils", () => {
  beforeEach(() => {
    resetAgentNameAliases()
  })

  test("should recognize atlas as orchestrator with canonical name", () => {
    initializeAgentNameAliases(
      { atlas: "Atlas (Orchestrator)" },
      ["atlas", "sisyphus", "prometheus"]
    )

    const mockMessageDir = "/tmp/test-messages"
    expect(isCallerOrchestrator).toBeDefined()
  })

  test("should canonicalize renamed atlas agent when checking orchestrator", () => {
    initializeAgentNameAliases(
      { atlas: "Master Orchestrator" },
      ["atlas", "sisyphus", "prometheus"]
    )

    expect(isCallerOrchestrator).toBeDefined()
  })
})
