import { updateSessionAgent } from "../../features/claude-code-session-state"
import {
  getCompactionAgentConfigCheckpoint,
} from "../../shared/compaction-agent-config-checkpoint"
import { createInternalAgentTextPart } from "../../shared/internal-initiator-marker"
import { log } from "../../shared/logger"
import { setSessionModel } from "../../shared/session-model-state"
import { setSessionTools } from "../../shared/session-tools-store"
import {
  createExpectedRecoveryPromptConfig,
  isPromptConfigRecovered,
} from "./recovery-prompt-config"
import {
  resolveLatestSessionPromptConfig,
  resolveSessionPromptConfig,
} from "./session-prompt-config-resolver"
import { AGENT_RECOVERY_PROMPT, NO_TEXT_TAIL_THRESHOLD, RECOVERY_COOLDOWN_MS, RECENT_COMPACTION_WINDOW_MS } from "./constants"
import type { CompactionContextClient } from "./types"
import type { TailMonitorState } from "./tail-monitor"

export function createRecoveryLogic(
  ctx: CompactionContextClient | undefined,
  getTailState: (sessionID: string) => TailMonitorState,
) {
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
        log(`[compaction-context-injector] Re-injected agent config but recovery is still incomplete`, {
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

      log(`[compaction-context-injector] Re-injected checkpointed agent config`, {
        sessionID,
        reason,
        agent: expectedPromptConfig.agent,
        model,
      })

      return true
    } catch (error) {
      log(`[compaction-context-injector] Failed to re-inject checkpointed agent config`, {
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

    log(`[compaction-context-injector] Detected consecutive assistant messages with no text`, {
      sessionID,
      consecutiveNoTextMessages: tailState.consecutiveNoTextMessages,
      recentlyCompacted,
    })

    if (recentlyCompacted) {
      await recoverCheckpointedAgentConfig(sessionID, "no-text-tail")
    }
  }

  return {
    recoverCheckpointedAgentConfig,
    maybeWarnAboutNoTextTail,
  }
}
