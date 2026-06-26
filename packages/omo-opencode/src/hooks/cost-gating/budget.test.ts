import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, test, mock, spyOn } from "bun:test"
import { createCostGatingHook, estimateTokenCost, sessionAnnealingMap, sessionCosts, sessionBudgets, appendBudget } from "./hook"
import type { OhMyOpenCodeConfig } from "../../config"

describe("budget control and dynamic routing", () => {
  function mockPluginInput() {
    const showToastMock = mock(() => Promise.resolve({}))
    return {
      directory: "/fake/dir",
      client: {
        tui: {
          showToast: showToastMock,
        },
      },
    } as unknown as PluginInput
  }

  function mockConfig(budget = 0.20): OhMyOpenCodeConfig {
    return {
      max_session_budget_usd: budget,
    } as OhMyOpenCodeConfig
  }

  test("estimateTokenCost should calculate rates correctly", () => {
    // Sonnet rates: Input $3/M, Output $15/M
    const sonnetCost = estimateTokenCost("claude-3-5-sonnet", "anthropic", 100000, 10000)
    expect(sonnetCost).toBeCloseTo(0.3 + 0.15) // $0.45

    // Haiku rates: Input $0.8/M, Output $4/M
    const haikuCost = estimateTokenCost("claude-3-5-haiku", "anthropic", 100000, 10000)
    expect(haikuCost).toBeCloseTo(0.08 + 0.04) // $0.12

    // Flash rates: Input $0.075/M, Output $0.3/M
    const flashCost = estimateTokenCost("gemini-1.5-flash", "google", 1000000, 1000000)
    expect(flashCost).toBeCloseTo(0.075 + 0.3) // $0.375
  })

  test("should enable annealing when cost reaches 50% of budget", async () => {
    const ctx = mockPluginInput()
    const hook = createCostGatingHook(ctx, mockConfig(0.20))
    const sessionID = "ses_budget_50"

    // Set up message.updated with tokens that cost $0.11 (which is > 50% of $0.20)
    // Sonnet rates: 30000 input ($0.09) + 2000 output ($0.03) = $0.12
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            model: { providerID: "anthropic", modelID: "claude-3-5-sonnet" },
            tokens: { input: 30000, output: 2000 },
          },
        },
      },
    })

    expect(sessionCosts.get(sessionID)).toBeCloseTo(0.12)
    expect(sessionAnnealingMap.get(sessionID)).toBe(true)
  })

  test("should suspend execution when cost reaches 100% of budget, and resume on appendBudget", async () => {
    const ctx = mockPluginInput()
    const hook = createCostGatingHook(ctx, mockConfig(0.10))
    const sessionID = "ses_budget_100"

    // Set up cost at $0.12 (exceeding budget of $0.10)
    sessionCosts.set(sessionID, 0.12)

    let suspended = true
    const beforeHookPromise = hook["tool.execute.before"](
      { tool: "write", sessionID, callID: "c1" },
      { args: {} }
    ).then(() => {
      suspended = false
    })

    // Wait a brief moment to verify it is suspended/blocked
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(suspended).toBe(true)

    // Now append budget so budget is 0.10 + 0.05 = 0.15 > 0.12
    appendBudget(sessionID, 0.05)

    // Wait for the promise to resolve
    await beforeHookPromise
    expect(suspended).toBe(false)
  })
})
