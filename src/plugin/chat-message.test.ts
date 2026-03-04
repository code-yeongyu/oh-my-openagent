import { describe, test, expect, beforeEach } from "bun:test"

import { createChatMessageHandler } from "./chat-message"
import { setGlobalCompressionConfig, resetGlobalCompressionConfig } from "../shared/toon-compression/config-store"

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

function createMockOutput(variant?: string, parts?: ChatMessagePart[]): ChatMessageHandlerOutput {
  const message: Record<string, unknown> = {}
  if (variant !== undefined) {
    message["variant"] = variant
  }
  return { message, parts: parts ?? [] }
}

describe("createChatMessageHandler - TUI variant passthrough", () => {
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

  test("first message: marks gate as applied regardless of variant presence", async () => {
    //#given - first message with user-selected variant
    const args = createMockHandlerArgs({ shouldOverride: true })
    const handler = createChatMessageHandler(args)
    const input = createMockInput("hephaestus", { providerID: "openai", modelID: "gpt-5.3-codex" })
    const output = createMockOutput("xhigh")

    //#when
    await handler(input, output)

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

describe("createChatMessageHandler - toon compression", () => {
  beforeEach(() => {
    resetGlobalCompressionConfig()
  })

  function createLargePartsArray(count: number): ChatMessagePart[] {
    return Array.from({ length: count }, (_, i) => ({
      type: "text",
      text: `Message part ${i} with some content to make it larger`,
    }))
  }

  test("does not compress small parts array", async () => {
    //#given - small parts array, compression enabled
    const config = { enabled: true, threshold: 100 }
    setGlobalCompressionConfig(config)
    const args = createMockHandlerArgs({
      pluginConfig: { toon_compression: config },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const smallParts = [{ type: "text", text: "hello" }]
    const output = createMockOutput(undefined, smallParts)

    //#when
    await handler(input, output)

    //#then - no compression applied for small array
    expect(output.message["_compressedParts"]).toBeUndefined()
  })

  test("compresses large uniform parts array when enabled", async () => {
    //#given - large uniform parts array, compression enabled with low threshold
    const config = { enabled: true, threshold: 100 }
    setGlobalCompressionConfig(config)
    const args = createMockHandlerArgs({
      pluginConfig: { toon_compression: config },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const largeParts = createLargePartsArray(10)
    const output = createMockOutput(undefined, largeParts)

    //#when
    await handler(input, output)

    //#then - compression should be applied
    expect(output.message["_compressedParts"]).toBeDefined()
    expect(typeof output.message["_compressedParts"]).toBe("string")
  })

  test("does not compress when disabled even with large array", async () => {
    //#given - large parts array, compression disabled
    const config = { enabled: false, threshold: 100 }
    setGlobalCompressionConfig(config)
    const args = createMockHandlerArgs({
      pluginConfig: { toon_compression: config },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const largeParts = createLargePartsArray(10)
    const output = createMockOutput(undefined, largeParts)

    //#when
    await handler(input, output)

    //#then - no compression when disabled
    expect(output.message["_compressedParts"]).toBeUndefined()
  })

  test("uses default config when toon_compression not specified", async () => {
    //#given - no compression config specified (uses defaults: disabled)
    const args = createMockHandlerArgs({ pluginConfig: {} })
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const largeParts = createLargePartsArray(10)
    const output = createMockOutput(undefined, largeParts)

    //#when
    await handler(input, output)

    //#then - defaults to disabled, no compression
    expect(output.message["_compressedParts"]).toBeUndefined()
  })

  test("does not compress non-uniform parts array", async () => {
    //#given - large but non-uniform parts array
    const config = { enabled: true, threshold: 100 }
    setGlobalCompressionConfig(config)
    const args = createMockHandlerArgs({
      pluginConfig: { toon_compression: config },
    })
    const handler = createChatMessageHandler(args)
    const input = createMockInput()
    const nonUniformParts = [
      { type: "text", text: "hello" },
      { type: "image", url: "http://example.com/img.png" },
      { type: "text", text: "world" },
      { type: "code", language: "ts", content: "const x = 1" },
      { type: "text", text: "test" },
    ]
    const output = createMockOutput(undefined, nonUniformParts)

    //#when
    await handler(input, output)

    //#then - non-uniform arrays should not be compressed
    expect(output.message["_compressedParts"]).toBeUndefined()
  })
})
