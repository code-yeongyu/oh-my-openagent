import type { BackgroundManager } from "../../features/background-agent"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import {
  clearCompactionAgentConfigCheckpoint,
  getCompactionAgentConfigCheckpoint,
  setCompactionAgentConfigCheckpoint,
} from "../../shared/compaction-agent-config-checkpoint"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { setSessionModel } from "../../shared/session-model-state"
import { setSessionTools } from "../../shared/session-tools-store"
import { COMPACTION_CONTEXT_PROMPT } from "./compaction-context-prompt"
import {
  createExpectedRecoveryPromptConfig,
  isPromptConfigRecovered,
} from "./recovery-prompt-config"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"
import {
  finalizeTrackedAssistantMessage,
  shouldTreatAssistantPartAsOutput,
  trackAssistantOutput,
  type TailMonitorState,
} from "./tail-monitor"

const HOOK_NAME = "compaction-context-injector"
const AGENT_RECOVERY_PROMPT = "[restore checkpointed session agent configuration after compaction]"
const NO_TEXT_TAIL_THRESHOLD = 5
const RECOVERY_COOLDOWN_MS = 60_000
const RECENT_COMPACTION_WINDOW_MS = 10 * 60 * 1000

type CompactionContextClient = {
  client: {
    session: {
      messages: (input: { path: { id: string } }) => Promise<unknown>
      promptAsync: (input: {
        path: { id: string }
        body: {
          noReply?: boolean
          agent?: string
          model?: { providerID: string; modelID: string }
          tools?: Record<string, boolean>
          parts: Array<{ type: "text"; text: string }>
        }
        query?: { directory: string }
      }) => Promise<unknown>
    }
  }
  directory: string
}

export interface CompactionContextInjector {
  capture: (sessionID: string) => Promise<void>
  inject: (sessionID?: string) => string
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

function isCompactionAgent(agent: string | undefined): boolean {
  return agent?.trim().toLowerCase() === "compaction"
}

function resolveSessionID(props?: Record<string, unknown>): string | undefined {
  return (props?.sessionID ??
    (props?.info as { id?: string } | undefined)?.id) as string | undefined
}

export function createCompactionContextInjector(options?: {
  ctx?: CompactionContextClient
  backgroundManager?: BackgroundManager
}): CompactionContextInjector {
  const ctx = options?.ctx
  const backgroundManager = options?.backgroundManager
  const tailStates = new Map<string, TailMonitorState>()

  const getTailState = (sessionID: string): TailMonitorState => {
    const existing = tailStates.get(sessionID)
    if (existing) {
      return existing
    }

    const created: TailMonitorState = {
      currentHasOutput: false,
      consecutiveNoTextMessages: 0,
    }
    tailStates.set(sessionID, created)
    return created
  }

  const recoverCheckpointedAgentConfig = async (
    sessionID: string,
    reason: "session.compacted" | "no-text-tail",
  ): Promise<boolean> => {
    if (!ctx) {
      return false
    }

    const checkpoint = getCompactionAgentConfigCheckpoint(sessionID)
    if (!checkpoint?.agent) {
      return false
    }
    const checkpointWithAgent = {
      ...checkpoint,
      agent: checkpoint.agent,
    }

    const tailState = getTailState(sessionID)
    const now = Date.now()
    if (tailState.lastRecoveryAt && now - tailState.lastRecoveryAt < RECOVERY_COOLDOWN_MS) {
      return false
    }

    const currentPromptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    const expectedPromptConfig = createExpectedRecoveryPromptConfig(
      checkpointWithAgent,
      currentPromptConfig,
    )
    const model = expectedPromptConfig.model
    const tools = expectedPromptConfig.tools

    if (reason === "session.compacted") {
      const latestPromptConfig = await resolveLatestSessionPromptConfig(ctx, sessionID)
      if (isPromptConfigRecovered(latestPromptConfig, expectedPromptConfig)) {
        return false
      }
    }

    try {
      await ctx.client.session.promptAsync({
        path: { id: sessionID },
        body: {
          noReply: true,
          agent: expectedPromptConfig.agent,
          ...(model ? { model } : {}),
          ...(tools ? { tools } : {}),
          parts: [createInternalAgentTextPart(AGENT_RECOVERY_PROMPT)],
        },
        query: { directory: ctx.directory },
      })

      const recoveredPromptConfig = await resolveLatestSessionPromptConfig(ctx, sessionID)
      if (!isPromptConfigRecovered(recoveredPromptConfig, expectedPromptConfig)) {
        log(`[${HOOK_NAME}] Re-injected agent config but recovery is still incomplete`, {
          sessionID,
          reason,
          agent: expectedPromptConfig.agent,
          model,
          hasTools: !!tools,
          recoveredPromptConfig,
        })
        return false
      }

      updateSessionAgent(sessionID, expectedPromptConfig.agent)
      if (model) {
        setSessionModel(sessionID, model)
      }
      if (tools) {
        setSessionTools(sessionID, tools)
      }

      tailState.lastRecoveryAt = now
      tailState.consecutiveNoTextMessages = 0

      log(`[${HOOK_NAME}] Re-injected checkpointed agent config`, {
        sessionID,
        reason,
        agent: expectedPromptConfig.agent,
        model,
      })

      return true
    } catch (error) {
      log(`[${HOOK_NAME}] Failed to re-inject checkpointed agent config`, {
        sessionID,
        reason,
        error: String(error),
      })
      return false
    }
  }

  const maybeWarnAboutNoTextTail = async (sessionID: string): Promise<void> => {
    const tailState = getTailState(sessionID)
    if (tailState.consecutiveNoTextMessages < NO_TEXT_TAIL_THRESHOLD) {
      return
    }

    const recentlyCompacted =
      tailState.lastCompactedAt !== undefined &&
      Date.now() - tailState.lastCompactedAt < RECENT_COMPACTION_WINDOW_MS

    log(`[${HOOK_NAME}] Detected consecutive assistant messages with no text`, {
      sessionID,
      consecutiveNoTextMessages: tailState.consecutiveNoTextMessages,
      recentlyCompacted,
    })

    if (recentlyCompacted) {
      await recoverCheckpointedAgentConfig(sessionID, "no-text-tail")
    }
  }

  const capture = async (sessionID: string): Promise<void> => {
    if (!ctx || !sessionID) {
      return
    }

    const promptConfig = await resolveSessionPromptConfig(ctx, sessionID)
    if (!promptConfig.agent && !promptConfig.model && !promptConfig.tools) {
      return
    }

    setCompactionAgentConfigCheckpoint(sessionID, promptConfig)
    log(`[${HOOK_NAME}] Captured agent checkpoint before compaction`, {
      sessionID,
      agent: promptConfig.agent,
      model: promptConfig.model,
      hasTools: !!promptConfig.tools,
    })
  }

  const inject = (sessionID?: string): string => {
    let prompt = COMPACTION_CONTEXT_PROMPT

    if (backgroundManager && sessionID) {
      const history = backgroundManager.taskHistory.formatForCompaction(sessionID)
      if (history) {
        prompt += `\n### Active/Recent Delegated Sessions\n${history}\n`
      }
    }

    return prompt
  }

  const event = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        clearCompactionAgentConfigCheckpoint(sessionID)
        tailStates.delete(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const noTextCount = finalizeTrackedAssistantMessage(getTailState(sessionID))
      if (noTextCount > 0) {
        await maybeWarnAboutNoTextTail(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionID(props)
      if (!sessionID) {
        return
      }

      const tailState = getTailState(sessionID)
      finalizeTrackedAssistantMessage(tailState)
      tailState.lastCompactedAt = Date.now()
      await maybeWarnAboutNoTextTail(sessionID)
      await recoverCheckpointedAgentConfig(sessionID, "session.compacted")
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as {
        id?: string
        role?: string
        sessionID?: string
      } | undefined

      if (!info?.sessionID || info.role !== "assistant" || !info.id) {
        return
      }

      const tailState = getTailState(info.sessionID)
      if (tailState.currentMessageID && tailState.currentMessageID !== info.id) {
        finalizeTrackedAssistantMessage(tailState)
        await maybeWarnAboutNoTextTail(info.sessionID)
      }

      if (tailState.currentMessageID !== info.id) {
        tailState.currentMessageID = info.id
        tailState.currentHasOutput = false
      }
      return
    }

    if (event.type === "message.part.delta") {
      const sessionID = props?.sessionID as string | undefined
      const messageID = props?.messageID as string | undefined
      const field = props?.field as string | undefined
      const delta = props?.delta as string | undefined

      if (!sessionID || field !== "text" || !delta?.trim()) {
        return
      }

      trackAssistantOutput(getTailState(sessionID), messageID)
      return
    }

    if (event.type === "message.part.updated") {
      const part = props?.part as {
        messageID?: string
        sessionID?: string
        type?: string
        text?: string
      } | undefined

      if (!part?.sessionID || !shouldTreatAssistantPartAsOutput(part)) {
        return
      }

      trackAssistantOutput(getTailState(part.sessionID), part.messageID)
    }
  }

  return { capture, inject, event }
}
