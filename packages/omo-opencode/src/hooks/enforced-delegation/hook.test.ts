import type { PluginInput } from "@opencode-ai/plugin"
import { describe, expect, test, beforeEach, mock } from "bun:test"
import { createEnforcedDelegationHook } from "./hook"
import { updateSessionAgent, clearSessionAgent, _resetForTesting } from "../../features/claude-code-session-state"
import type { OhMyOpenCodeConfig } from "../../config"

describe("enforced-delegation hook", () => {
  beforeEach(() => {
    _resetForTesting()
  })

  function mockPluginInput(): PluginInput {
    return {
      directory: "/fake/dir",
      client: {
        tui: {
          showToast: async () => {},
        },
      },
    } as unknown as PluginInput
  }

  function mockConfig(enforceThreshold = 20000): OhMyOpenCodeConfig {
    return {
      enforce_subagent_threshold_tokens: enforceThreshold,
    } as OhMyOpenCodeConfig
  }

  test("should NOT block execution if session is not an orchestrator", async () => {
    const hook = createEnforcedDelegationHook(mockPluginInput(), mockConfig())
    const sessionID = "ses_explore"
    updateSessionAgent(sessionID, "explore") // non-orchestrator

    // Simulate token count above threshold
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            tokens: { input: 25000, output: 500 },
          },
        },
      },
    })

    const args = { file_path: "test.ts", content: "data" }
    expect(async () => {
      await hook["tool.execute.before"]({ tool: "write", sessionID, callID: "1" }, { args })
    }).not.toThrow()

    clearSessionAgent(sessionID)
  })

  test("should NOT block execution if token count is below threshold", async () => {
    const hook = createEnforcedDelegationHook(mockPluginInput(), mockConfig())
    const sessionID = "ses_sisyphus_below"
    updateSessionAgent(sessionID, "sisyphus") // orchestrator

    // Simulate token count below threshold
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            tokens: { input: 15000, output: 500 },
          },
        },
      },
    })

    const args = { file_path: "test.ts", content: "data" }
    expect(async () => {
      await hook["tool.execute.before"]({ tool: "write", sessionID, callID: "1" }, { args })
    }).not.toThrow()

    clearSessionAgent(sessionID)
  })

  test("should BLOCK execution if orchestrator session exceeds threshold for heavy tools", async () => {
    const mockTui = { showToast: mock(() => Promise.resolve()) }
    const ctx = {
      directory: "/fake/dir",
      client: { tui: mockTui },
    } as unknown as PluginInput

    const hook = createEnforcedDelegationHook(ctx, mockConfig(20000))
    const sessionID = "ses_sisyphus_above"
    updateSessionAgent(sessionID, "sisyphus") // orchestrator

    // Simulate token count above threshold
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          sessionID,
          info: {
            role: "assistant",
            tokens: { input: 21000, output: 500 },
          },
        },
      },
    })

    const args = { file_path: "test.ts", content: "data" }
    let errorThrown: Error | null = null
    try {
      await hook["tool.execute.before"]({ tool: "write", sessionID, callID: "1" }, { args })
    } catch (err) {
      errorThrown = err as Error
    }

    expect(errorThrown).not.toBeNull()
    expect(errorThrown!.message).toContain("Direct execution of search/file-editing tool 'write' is blocked")
    expect(mockTui.showToast).toHaveBeenCalled()

    clearSessionAgent(sessionID)
  })
})
