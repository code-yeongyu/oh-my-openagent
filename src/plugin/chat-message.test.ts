import { beforeEach, describe, test, expect } from "bun:test"

import { createChatMessageHandler } from "./chat-message"
import { clearSessionVariant, getSessionVariant, setSessionVariant } from "../shared/session-model-state"

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }

function createMockHandlerArgs(overrides?: {
  pluginConfig?: Record<string, unknown>
  shouldOverride?: boolean
}) {
  const appliedSessions: string[] = []
  return {
    ctx: { client: { tui: { showToast: async () => {} } } } as any,
    pluginConfig: (overrides?.pluginConfig ?? {}) as any,
    firstMessageVariantGate: {
      shouldOverride: () => overrides?.shouldOverride ?? false,
      markApplied: (sessionID: string) => { appliedSessions.push(sessionID) },
    },
    hooks: {
      stopContinuationGuard: null,
      backgroundNotificationHook: null,
      keywordDetector: null,
      claudeCodeHooks: null,
      autoSlashCommand: null,
      startWork: null,
      ralphLoop: null,
    } as any,
    _appliedSessions: appliedSessions,
  }
}

function createMockInput(agent?: string, model?: { providerID: string; modelID: string }) {
  return {
    sessionID: "test-session",
    agent,
    model,
  }
}

function createMockOutput(variant?: string): ChatMessageHandlerOutput {
  const message: Record<string, unknown> = {}
  if (variant !== undefined) {
    message["variant"] = variant
  }
  return { message, parts: [] }
}

describe("createChatMessageHandler - TUI variant passthrough", () => {
  beforeEach(() => {
    clearSessionVariant("test-session")
  })

  test("first message: does not override TUI variant when user has no selection", async () => {
    //#given - first message, no user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant set

    //#when
    await handler(input, output)

    //#then - TUI sent undefined, should stay undefined (no config override)
    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: preserves user-selected variant when already set", async () => {
    //#given - first message, user already selected "xhigh" variant in OpenCode UI
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh") // user selected xhigh

    //#when
    await handler(input, output)

    //#then - user's xhigh must be preserved
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: preserves TUI variant", async () => {
    //#given - not first message, variant already set
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then
    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: does not inject variant when TUI sends none", async () => {
    //#given - not first message, no variant from TUI
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput() // no variant

    //#when
    await handler(input, output)

    //#then - should stay undefined, not auto-resolved from config
    expect(output.message["variant"]).toBeUndefined()
  })

  test("persists explicit variant and reuses it when next message omits variant", async () => {
    //#given
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })

    const firstOutput = createMockOutput("medium")

    //#when
    await handler(input, firstOutput)
    const secondOutput = createMockOutput()
    await handler(input, secondOutput)

    //#then
    expect(firstOutput.message["variant"]).toBe("medium")
    expect(secondOutput.message["variant"]).toBe("medium")
  })

  test("does not re-inject persisted variant when model fallback explicitly removes variant", async () => {
    //#given
    const args = createMockHandlerArgs({ shouldOverride: false })
    args.hooks.modelFallback = {
      "chat.message": async (_input: { sessionID: string }, output: ChatMessageHandlerOutput): Promise<void> => {
        delete output.message["variant"]
      },
    }
    setSessionVariant("test-session", "max")

    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.message["variant"]).toBeUndefined()
    expect(getSessionVariant("test-session")).toBeUndefined()
  })

  test("first message: marks gate as applied regardless of variant presence", async () => {
    //#given - first message with user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

    //#then - gate should still be marked as applied
    expect(args._appliedSessions).toContain("test-session")
  })

  test("injects queued background notifications through chat.message hook", async () => {
    //#given
    const args = createMockHandlerArgs()
    args.hooks.backgroundNotificationHook = {
      "chat.message": async (
        _input: { sessionID: string },
        output: ChatMessageHandlerOutput,
      ): Promise<void> => {
        output.parts.push({
          type: "text",
          text: "<system-reminder>[BACKGROUND TASK COMPLETED]</system-reminder>",
        })
      },
    }
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    //#when
    await handler(input, output)

    //#then
    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("[BACKGROUND TASK COMPLETED]")
  })
})
