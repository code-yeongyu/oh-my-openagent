import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { isAgentRegistered } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { createInternalAgentTextPart, resolveInheritedPromptTools } from "../../shared"
import { HOOK_NAME } from "./hook-name"
import { BOULDER_CONTINUATION_PROMPT } from "./system-reminder-templates"
import { resolveRecentPromptContextForSession } from "./recent-model-resolver"
import type { SessionState } from "./types"

export type BoulderContinuationResult = "injected" | "skipped_background_tasks" | "skipped_agent_unavailable" | "failed"

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
  backgroundManager?: BackgroundManager
  sessionState: SessionState
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
  } = input

  const hasRunningBgTasks = backgroundManager
    ? backgroundManager.getTasksByParentSession(sessionID).some((t: { status: string }) => t.status === "running")
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
	const continuationAgent = agent ?? (isAgentRegistered("atlas") ? "atlas" : undefined)

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

    await ctx.client.session.promptAsync({
      path: { id: sessionID },
      body: {
        agent: continuationAgent,
        ...(launchModel ? { model: launchModel } : {}),
        ...(launchVariant ? { variant: launchVariant } : {}),
        ...(inheritedTools ? { tools: inheritedTools } : {}),
        parts: [createInternalAgentTextPart(prompt)],
      },
      query: { directory: ctx.directory },
    })

    sessionState.promptFailureCount = 0
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
