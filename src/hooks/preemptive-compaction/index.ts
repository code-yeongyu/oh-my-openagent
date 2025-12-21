import type { PluginInput } from "@opencode-ai/plugin"
import type { ExperimentalConfig } from "../../config"
import type { PreemptiveCompactionState, TokenInfo } from "./types"
import {
  DEFAULT_THRESHOLD,
  MIN_TOKENS_FOR_COMPACTION,
  COMPACTION_COOLDOWN_MS,
} from "./constants"
import { log } from "../../shared/logger"

export interface SummarizeContext {
  sessionID: string
  providerID: string
  modelID: string
  usageRatio: number
  directory: string
}

export type BeforeSummarizeCallback = (ctx: SummarizeContext) => Promise<void> | void

export type GetModelLimitCallback = (providerID: string, modelID: string) => number | undefined

export interface PreemptiveCompactionOptions {
  experimental?: ExperimentalConfig
  onBeforeSummarize?: BeforeSummarizeCallback
  getModelLimit?: GetModelLimitCallback
}

interface MessageInfo {
  id: string
  role: string
  sessionID: string
  providerID?: string
  modelID?: string
  tokens?: TokenInfo
  summary?: boolean
  finish?: boolean
}

interface MessageWrapper {
  info: MessageInfo
}

const CLAUDE_MODEL_PATTERN = /claude-(opus|sonnet|haiku)/i
const CLAUDE_DEFAULT_CONTEXT_LIMIT = 200_000

function isSupportedModel(modelID: string): boolean {
  return CLAUDE_MODEL_PATTERN.test(modelID)
}

function createState(): PreemptiveCompactionState {
  return {
    lastCompactionTime: new Map(),
    compactionInProgress: new Set(),
  }
}

export function createPreemptiveCompactionHook(
  ctx: PluginInput,
  options?: PreemptiveCompactionOptions
) {
  const experimental = options?.experimental
  const onBeforeSummarize = options?.onBeforeSummarize
  const getModelLimit = options?.getModelLimit
  const enabled = experimental?.preemptive_compaction !== false
  const threshold = experimental?.preemptive_compaction_threshold ?? DEFAULT_THRESHOLD

  if (!enabled) {
    return { event: async () => {} }
  }

  const state = createState()

  const checkAndTriggerCompaction = async (
    sessionID: string,
    lastAssistant: MessageInfo
  ): Promise<void> => {
    if (state.compactionInProgress.has(sessionID)) return

    const lastCompaction = state.lastCompactionTime.get(sessionID) ?? 0
    if (Date.now() - lastCompaction < COMPACTION_COOLDOWN_MS) return

    if (lastAssistant.summary === true) return

    const tokens = lastAssistant.tokens
    if (!tokens) return

    const modelID = lastAssistant.modelID ?? ""
    const providerID = lastAssistant.providerID ?? ""

    if (!isSupportedModel(modelID)) {
      log("[preemptive-compaction] skipping unsupported model", { modelID })
      return
    }

    const configLimit = getModelLimit?.(providerID, modelID)
    const contextLimit = configLimit ?? CLAUDE_DEFAULT_CONTEXT_LIMIT
    const totalUsed = tokens.input + tokens.cache.read + tokens.output

    if (totalUsed < MIN_TOKENS_FOR_COMPACTION) return

    const usageRatio = totalUsed / contextLimit

    log("[preemptive-compaction] checking", {
      sessionID,
      totalUsed,
      contextLimit,
      usageRatio: usageRatio.toFixed(2),
      threshold,
    })

    if (usageRatio < threshold) return

    state.compactionInProgress.add(sessionID)
    state.lastCompactionTime.set(sessionID, Date.now())

    if (!providerID || !modelID) {
      state.compactionInProgress.delete(sessionID)
      return
    }

    await ctx.client.tui
      .showToast({
        body: {
          title: "Preemptive Compaction",
          message: `Context at ${(usageRatio * 100).toFixed(0)}% - compacting to prevent overflow...`,
          variant: "warning",
          duration: 3000,
        },
      })
      .catch(() => {})

    log("[preemptive-compaction] triggering compaction", { sessionID, usageRatio })

    try {
      if (onBeforeSummarize) {
        await onBeforeSummarize({
          sessionID,
          providerID,
          modelID,
          usageRatio,
          directory: ctx.directory,
        })
      }

      await ctx.client.session.summarize({
        path: { id: sessionID },
        body: { providerID, modelID },
        query: { directory: ctx.directory },
      })

      await ctx.client.tui
        .showToast({
          body: {
            title: "Compaction Complete",
            message: "Session compacted successfully",
            variant: "success",
            duration: 2000,
          },
        })
        .catch(() => {})
    } catch (err) {
      log("[preemptive-compaction] compaction failed", { sessionID, error: err })
    } finally {
      state.compactionInProgress.delete(sessionID)
    }
  }

  const eventHandler = async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        state.lastCompactionTime.delete(sessionInfo.id)
        state.compactionInProgress.delete(sessionInfo.id)
      }
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as MessageInfo | undefined
      if (!info) return

      if (info.role !== "assistant" || !info.finish) return

      const sessionID = info.sessionID
      if (!sessionID) return

      await checkAndTriggerCompaction(sessionID, info)
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      try {
        const resp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })

        const messages = (resp.data ?? resp) as MessageWrapper[]
        const assistants = messages
          .filter((m) => m.info.role === "assistant")
          .map((m) => m.info)

        if (assistants.length === 0) return

        const lastAssistant = assistants[assistants.length - 1]
        await checkAndTriggerCompaction(sessionID, lastAssistant)
      } catch {}
    }
  }

  return {
    event: eventHandler,
  }
}
