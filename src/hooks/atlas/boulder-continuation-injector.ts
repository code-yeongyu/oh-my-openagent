import type { PluginInput } from "@opencode-ai/plugin"
import {
  isAgentRegistered,
  resolveRegisteredAgentName,
} from "../../features/claude-code-session-state"
import { stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import { createInternalAgentContinuationTextPart, resolveInheritedPromptTools } from "../../shared"
import { dispatchInternalPrompt } from "../shared/prompt-async-gate"
import { HOOK_NAME } from "./hook-name"
import { BOULDER_CONTINUATION_PROMPT } from "./system-reminder-templates"
import { markContinuationInjectedAwaitingToolProgress } from "./tool-progress"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"
import type { BackgroundTaskStatusProvider, SessionState } from "./types"

export type BoulderContinuationResult =
  | "injected"
  | "skipped_active_session"
  | "skipped_background_tasks"
  | "skipped_agent_unavailable"
  | "failed"

const ACTIVE_BACKGROUND_TASK_STATUSES = new Set(["pending", "running"])

export async function injectBoulderContinuation(input: {
  ctx: PluginInput
  sessionID: string
  planName: string
  remaining: number
  total: number
  agent?: string
  worktreePath?: string
  preferredTaskSessionId?: string
  preferredTaskTitle?: string
  backgroundManager?: BackgroundTaskStatusProvider
  sessionState: SessionState
  idleSettleMs?: number
}): Promise<BoulderContinuationResult> {
  const {
    ctx,
    sessionID,
    planName,
    remaining,
    total,
    agent,
    worktreePath,
    preferredTaskSessionId,
    preferredTaskTitle,
    backgroundManager,
    sessionState,
    idleSettleMs,
  } = input

  const hasRunningBgTasks = backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((t: { status: string }) => ACTIVE_BACKGROUND_TASK_STATUSES.has(t.status))
    : false

  if (hasRunningBgTasks) {
    log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
    return "skipped_background_tasks"
  }

  const worktreeContext = worktreePath ? `\n\n[Worktree: ${worktreePath}]` : ""
  const preferredSessionContext = preferredTaskSessionId
    ? `\n\n[Preferred reuse session for current top-level plan task${preferredTaskTitle ? `: ${preferredTaskTitle}` : ""}: ${preferredTaskSessionId}]`
    : ""
	const prompt =
		BOULDER_CONTINUATION_PROMPT.replace(/{PLAN_NAME}/g, planName) +
		`\n\n[Status: ${total - remaining}/${total} completed, ${remaining} remaining]` +
		preferredSessionContext +
		worktreeContext
	const resolvedContinuationAgent = resolveRegisteredAgentName(
		agent ?? (isAgentRegistered("atlas") ? "atlas" : undefined),
	)
	const continuationAgent = resolvedContinuationAgent ? stripAgentListSortPrefix(resolvedContinuationAgent) : resolvedContinuationAgent

	if (!continuationAgent || !isAgentRegistered(continuationAgent)) {
		log(`[${HOOK_NAME}] Skipped injection: continuation agent unavailable`, {
			sessionID,
			agent: continuationAgent ?? agent ?? "unknown",
		})
    return "skipped_agent_unavailable"
  }

  try {
    log(`[${HOOK_NAME}] Injecting boulder continuation`, { sessionID, planName, remaining })

    const promptContext = await resolveRecentPromptContextForSession(ctx, sessionID)
    const inheritedTools = resolveInheritedPromptTools(sessionID, promptContext.tools)

    const launchModel = promptContext.model
      ? { providerID: promptContext.model.providerID, modelID: promptContext.model.modelID }
      : undefined
    const launchVariant = promptContext.model?.variant

    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: HOOK_NAME,
      settleMs: idleSettleMs,
      input: {
        path: { id: sessionID },
        body: {
          agent: continuationAgent,
          ...(launchModel ? { model: launchModel } : {}),
          ...(launchVariant ? { variant: launchVariant } : {}),
          ...(inheritedTools ? { tools: inheritedTools } : {}),
          parts: [createInternalAgentContinuationTextPart(prompt)],
        },
        query: { directory: ctx.directory },
      },
    })
    if (promptResult.status === "failed") {
      throw promptResult.error
    }
    if (promptResult.status !== "dispatched") {
      log(`[${HOOK_NAME}] Boulder continuation skipped by promptAsync gate`, {
        sessionID,
        status: promptResult.status,
      })
      return "skipped_active_session"
    }

    sessionState.promptFailureCount = 0
    markContinuationInjectedAwaitingToolProgress(sessionState)
    log(`[${HOOK_NAME}] Boulder continuation injected`, { sessionID })
    return "injected"
  } catch (err) {
    sessionState.promptFailureCount += 1
    sessionState.lastFailureAt = Date.now()
    log(`[${HOOK_NAME}] Boulder continuation failed`, {
      sessionID,
      error: String(err),
      promptFailureCount: sessionState.promptFailureCount,
    })
    return "failed"
  }
}
