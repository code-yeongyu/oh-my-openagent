import { describe, test, expect, mock } from "bun:test"

import { createChatMessageHandler } from "./chat-message"

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
      startTeammode: null,
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

const startTeammodePrompt =
  "You are starting Atlas Team Mode.\n<session-context>Session ID: $SESSION_ID\nTimestamp: $TIMESTAMP</session-context>"
const startWorkPrompt =
  "You are starting a Sisyphus work session.\n<session-context>Session ID: $SESSION_ID\nTimestamp: $TIMESTAMP</session-context>"

describe("createChatMessageHandler - TUI variant passthrough", () => {
  test("first message: does not override TUI variant when user has no selection", async () => {
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    await handler(input, output)

    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: preserves user-selected variant when already set", async () => {
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    await handler(input, output)

    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: preserves TUI variant", async () => {
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    await handler(input, output)

    expect(output.message["variant"]).toBe("xhigh")
  })

  test("subsequent message: does not inject variant when TUI sends none", async () => {
    const args = createMockHandlerArgs({ shouldOverride: false })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput()

    await handler(input, output)

    expect(output.message["variant"]).toBeUndefined()
  })

  test("first message: marks gate as applied regardless of variant presence", async () => {
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    await handler(input, output)

    expect(args._appliedSessions).toContain("test-session")
  })

  test("injects queued background notifications through chat.message hook", async () => {
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

    await handler(input, output)

    expect(output.parts).toHaveLength(1)
    expect(output.parts[0].text).toContain("[BACKGROUND TASK COMPLETED]")
  })

  test("start-teammode short-circuits start-work", async () => {
    const args = createMockHandlerArgs()
    const startTeammode = mock(async () => {})
    const startWork = mock(async () => {})
    args.hooks.startTeammode = { "chat.message": startTeammode }
    args.hooks.startWork = { "chat.message": startWork }
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: startTeammodePrompt }],
    }

    await handler(input, output)

    expect(startTeammode).toHaveBeenCalledTimes(1)
    expect(startWork).toHaveBeenCalledTimes(0)
  })

  test("start-work still runs for non-teammode command output", async () => {
    const args = createMockHandlerArgs()
    const startTeammode = mock(async () => {})
    const startWork = mock(async () => {})
    args.hooks.startTeammode = { "chat.message": startTeammode }
    args.hooks.startWork = { "chat.message": startWork }
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const output: ChatMessageHandlerOutput = {
      message: {},
      parts: [{ type: "text", text: startWorkPrompt }],
    }

    await handler(input, output)

    expect(startTeammode).toHaveBeenCalledTimes(1)
    expect(startWork).toHaveBeenCalledTimes(1)
  })
})
