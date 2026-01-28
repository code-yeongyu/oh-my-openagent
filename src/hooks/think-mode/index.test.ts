import { describe, expect, it, beforeEach } from "bun:test"
import type { ThinkModeInput } from "./types"

const { createThinkModeHook, clearThinkModeState } = await import("./index")

/**
 * Helper to create a mock ThinkModeInput for testing
 */
function createMockInput(
  providerID: string,
  modelID: string,
  promptText: string
): ThinkModeInput {
  return {
    parts: [{ type: "text", text: promptText }],
    message: {
      model: {
        providerID,
        modelID,
      },
    },
  }
}

/**
 * Type helper for accessing dynamically injected properties on message
 */
type MessageWithInjectedProps = Record<string, unknown>

describe("createThinkModeHook integration", () => {
  const sessionID = "test-session-id"

  beforeEach(() => {
    clearThinkModeState(sessionID)
  })

  describe("GitHub Copilot provider integration", () => {
    describe("Claude models", () => {
      it("should activate thinking mode for github-copilot Claude with think keyword", async () => {
        // #given a github-copilot Claude model and prompt with "think" keyword
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "claude-opus-4-5",
          "Please think deeply about this problem"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant and inject thinking config
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("claude-opus-4-5-high")
        expect(message.thinking).toBeDefined()
        expect((message.thinking as Record<string, unknown>)?.type).toBe(
          "enabled"
        )
        expect(
          (message.thinking as Record<string, unknown>)?.budgetTokens
        ).toBe(64000)
      })

      it("should handle github-copilot Claude with dots in version", async () => {
        // #given a github-copilot Claude model with dot format (claude-opus-4.5)
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "claude-opus-4.5",
          "ultrathink mode"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant (hyphen format)
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("claude-opus-4-5-high")
        expect(message.thinking).toBeDefined()
      })

      it("should handle github-copilot Claude Sonnet", async () => {
        // #given a github-copilot Claude Sonnet model
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "claude-sonnet-4-5",
          "think about this"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("claude-sonnet-4-5-high")
        expect(message.thinking).toBeDefined()
      })
    })

    describe("Gemini models", () => {
      it("should activate thinking mode for github-copilot Gemini Pro", async () => {
        // #given a github-copilot Gemini Pro model
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "gemini-3-pro",
          "think about this"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant and inject google thinking config
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("gemini-3-pro-high")
        expect(message.providerOptions).toBeDefined()
        const googleOptions = (
          message.providerOptions as Record<string, unknown>
        )?.google as Record<string, unknown>
        expect(googleOptions?.thinkingConfig).toBeDefined()
      })

      it("should activate thinking mode for github-copilot Gemini Flash", async () => {
        // #given a github-copilot Gemini Flash model
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "gemini-3-flash",
          "ultrathink"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("gemini-3-flash-high")
        expect(message.providerOptions).toBeDefined()
      })
    })

    describe("GPT models", () => {
      it("should activate thinking mode for github-copilot GPT-5.2", async () => {
        // #given a github-copilot GPT-5.2 model
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "gpt-5.2",
          "please think"
        )

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant and inject openai thinking config
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("gpt-5-2-high")
        expect(message.reasoning_effort).toBe("high")
      })

      it("should activate thinking mode for github-copilot GPT-5", async () => {
        // #given a github-copilot GPT-5 model
        const hook = createThinkModeHook()
        const input = createMockInput("github-copilot", "gpt-5", "think deeply")

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should upgrade to high variant
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe("gpt-5-high")
        expect(message.reasoning_effort).toBe("high")
      })
    })

    describe("No think keyword", () => {
      it("should NOT activate for github-copilot without think keyword", async () => {
        // #given a prompt without any think keyword
        const hook = createThinkModeHook()
        const input = createMockInput(
          "github-copilot",
          "claude-opus-4-5",
          "Just do this task"
        )
        const originalModelID = input.message.model?.modelID

        // #when the chat.params hook is called
        await hook["chat.params"](input, sessionID)

        // #then should NOT change model or inject config
        const message = input.message as MessageWithInjectedProps
        expect(input.message.model?.modelID).toBe(originalModelID)
        expect(message.thinking).toBeUndefined()
      })
    })
  })

  describe("Backwards compatibility with direct providers", () => {
    it("should still work for direct anthropic provider", async () => {
      // #given direct anthropic provider
      const hook = createThinkModeHook()
      const input = createMockInput(
        "anthropic",
        "claude-sonnet-4-5",
        "think about this"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should work as before
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("claude-sonnet-4-5-high")
      expect(message.thinking).toBeDefined()
    })

    it("should still work for direct google provider", async () => {
      // #given direct google provider
      const hook = createThinkModeHook()
      const input = createMockInput(
        "google",
        "gemini-3-pro",
        "think about this"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should work as before
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("gemini-3-pro-high")
      expect(message.providerOptions).toBeDefined()
    })

    it("should still work for direct openai provider", async () => {
      // #given direct openai provider
      const hook = createThinkModeHook()
      const input = createMockInput("openai", "gpt-5", "think about this")

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should work
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("gpt-5-high")
      expect(message.reasoning_effort).toBe("high")
    })

    it("should still work for amazon-bedrock provider", async () => {
      // #given amazon-bedrock provider
      const hook = createThinkModeHook()
      const input = createMockInput(
        "amazon-bedrock",
        "claude-sonnet-4-5",
        "think"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should inject bedrock thinking config
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("claude-sonnet-4-5-high")
      expect(message.reasoningConfig).toBeDefined()
    })
  })

  describe("Already-high variants", () => {
    it("should NOT re-upgrade already-high variants", async () => {
      // #given an already-high variant model
      const hook = createThinkModeHook()
      const input = createMockInput(
        "github-copilot",
        "claude-opus-4-5-high",
        "think deeply"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should NOT modify the model (already high)
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("claude-opus-4-5-high")
      // No additional thinking config should be injected
      expect(message.thinking).toBeUndefined()
    })

    it("should NOT re-upgrade already-high GPT variants", async () => {
      // #given an already-high GPT variant
      const hook = createThinkModeHook()
      const input = createMockInput(
        "github-copilot",
        "gpt-5.2-high",
        "ultrathink"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should NOT modify the model
      const message = input.message as MessageWithInjectedProps
      expect(input.message.model?.modelID).toBe("gpt-5.2-high")
      expect(message.reasoning_effort).toBeUndefined()
    })
  })

  describe("Unknown models", () => {
    it("should not crash for unknown models via github-copilot", async () => {
      // #given an unknown model type
      const hook = createThinkModeHook()
      const input = createMockInput(
        "github-copilot",
        "llama-3-70b",
        "think about this"
      )

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should not crash and model should remain unchanged
      expect(input.message.model?.modelID).toBe("llama-3-70b")
    })
  })

  describe("Edge cases", () => {
    it("should handle missing model gracefully", async () => {
      // #given input without a model
      const hook = createThinkModeHook()
      const input: ThinkModeInput = {
        parts: [{ type: "text", text: "think about this" }],
        message: {},
      }

      // #when the chat.params hook is called
      // #then should not crash
      await expect(
        hook["chat.params"](input, sessionID)
      ).resolves.toBeUndefined()
    })

    it("should handle empty prompt gracefully", async () => {
      // #given empty prompt
      const hook = createThinkModeHook()
      const input = createMockInput("github-copilot", "claude-opus-4-5", "")

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should not upgrade (no think keyword)
      expect(input.message.model?.modelID).toBe("claude-opus-4-5")
    })
  })

  describe("Agent-level thinking configuration respect", () => {
    it("should NOT inject thinking config when agent has thinking disabled", async () => {
      // #given agent with thinking explicitly disabled
      const hook = createThinkModeHook()
      const input: ThinkModeInput = {
        parts: [{ type: "text", text: "ultrathink deeply" }],
        message: {
          model: { providerID: "google", modelID: "gemini-3-pro" },
          thinking: { type: "disabled" },
        } as ThinkModeInput["message"],
      }

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should NOT override agent's thinking disabled setting
      const message = input.message as MessageWithInjectedProps
      expect((message.thinking as { type: string }).type).toBe("disabled")
      expect(message.providerOptions).toBeUndefined()
    })

    it("should NOT inject thinking config when agent has custom providerOptions", async () => {
      // #given agent with custom providerOptions
      const hook = createThinkModeHook()
      const input: ThinkModeInput = {
        parts: [{ type: "text", text: "ultrathink" }],
        message: {
          model: { providerID: "google", modelID: "gemini-3-flash" },
          providerOptions: {
            google: { thinkingConfig: { thinkingBudget: 0 } },
          },
        } as ThinkModeInput["message"],
      }

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should NOT override agent's providerOptions
      const message = input.message as MessageWithInjectedProps
      const providerOpts = message.providerOptions as Record<string, unknown>
      expect((providerOpts.google as Record<string, unknown>).thinkingConfig).toEqual({
        thinkingBudget: 0,
      })
    })

    it("should still inject thinking config when agent has no thinking override", async () => {
      // #given agent without thinking override
      const hook = createThinkModeHook()
      const input = createMockInput("google", "gemini-3-pro", "ultrathink")

      // #when the chat.params hook is called
      await hook["chat.params"](input, sessionID)

      // #then should inject thinking config as normal
      const message = input.message as MessageWithInjectedProps
      expect(message.providerOptions).toBeDefined()
    })
  })
})
