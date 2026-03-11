import type { Message, Part } from "@opencode-ai/sdk"
import type { OhMyOpenCodeConfig } from "../../config"
import { classifyMessages, compressMessages } from "../../features/context-gc"
import { log } from "../../shared/logger"

const DEFAULT_CONTEXT_LIMIT = 200_000
const DEFAULT_GC_TRIGGER_PCT = 60
const DEFAULT_GC_TARGET_PCT = 40
const DEFAULT_GC_COOLDOWN_MS = 30_000

interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

interface CachedTokenState {
  tokens: TokenInfo
  lastGcAt: number
}

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
  event?: (args: { event: { type: string; properties?: unknown } }) => Promise<void>
}

function getContextLimit(): number {
  if (
    process.env.ANTHROPIC_1M_CONTEXT === "true" ||
    process.env.VERTEX_ANTHROPIC_1M_CONTEXT === "true"
  ) {
    return 1_000_000
  }
  return DEFAULT_CONTEXT_LIMIT
}

export function createContextGcHook(
  pluginConfig: OhMyOpenCodeConfig,
): MessagesTransformHook {
  const tokenCache = new Map<string, CachedTokenState>()
  const gcConfig = pluginConfig.experimental?.context_gc_config

  const triggerPct = (gcConfig?.gc_trigger_pct ?? DEFAULT_GC_TRIGGER_PCT) / 100
  const targetPct = (gcConfig?.gc_target_pct ?? DEFAULT_GC_TARGET_PCT) / 100
  const cooldownMs = gcConfig?.gc_cooldown_ms ?? DEFAULT_GC_COOLDOWN_MS

  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (!messages || messages.length === 0) return

      const firstMsg = messages[0]
      const sessionID = (firstMsg.info as unknown as { sessionID?: string }).sessionID
      if (!sessionID) return

      const cached = tokenCache.get(sessionID)
      if (!cached) return

      const now = Date.now()
      if (now - cached.lastGcAt < cooldownMs) return

      const contextLimit = getContextLimit()
      const totalTokens = (cached.tokens.input ?? 0) + (cached.tokens.cache?.read ?? 0)
      const usagePct = totalTokens / contextLimit

      if (usagePct < triggerPct) return

      const tokensToFree = Math.max(0, Math.round((usagePct - targetPct) * contextLimit))

      const gcMessages = messages as unknown as Parameters<typeof classifyMessages>[0]
      const classifications = classifyMessages(gcMessages, gcConfig)
      const stats = compressMessages(gcMessages, classifications, gcConfig, tokensToFree)

      cached.lastGcAt = now

      log("[context-gc] GC cycle complete", {
        sessionID,
        usagePct: (usagePct * 100).toFixed(1),
        tokensToFree,
        toolOutputsCompressed: stats.toolOutputsCompressed,
        textPartsCompressed: stats.textPartsCompressed,
        messagesRemoved: stats.messagesRemoved,
      })
    },

    event: async ({ event }) => {
      const props = event.properties as Record<string, unknown> | undefined

      if (event.type === "session.deleted") {
        const info = props?.info as { id?: string } | undefined
        if (info?.id) tokenCache.delete(info.id)
        return
      }

      if (event.type === "message.updated") {
        const info = props?.info as {
          role?: string
          sessionID?: string
          finish?: boolean
          tokens?: TokenInfo
        } | undefined

        if (!info || info.role !== "assistant" || !info.finish) return
        if (!info.sessionID || !info.tokens) return

        const existing = tokenCache.get(info.sessionID)
        tokenCache.set(info.sessionID, {
          tokens: info.tokens,
          lastGcAt: existing?.lastGcAt ?? 0,
        })
      }
    },
  }
}
