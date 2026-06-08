import type { PluginInput } from "@opencode-ai/plugin"
import {
  readBoulderState,
  findPrometheusPlans,
  normalizeSessionId,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import {
  isAgentRegistered,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { detectWorktreePath } from "./worktree-detector"
import { parseUserRequest } from "./parse-user-request"
import { buildStartWorkContextInfo } from "./context-info-builder"
import { createWorktreeActiveBlock } from "./worktree-block"
import { findRecentSessionPlanPath } from "./session-plan-affinity"

export const HOOK_NAME = "start-work" as const
const START_WORK_TEMPLATE_MARKER = "You are starting a Sisyphus work session."
const CONTEXT_INFO_MARKER = "<!-- omo-start-work-context -->"

interface StartWorkHookInput {
  sessionID: string
  messageID?: string
}

interface StartWorkCommandExecuteBeforeInput {
  sessionID: string
  command: string
  arguments: string
}

interface StartWorkHookOutput {
  message?: Record<string, unknown>
  parts: Array<{ type: string; text?: string }>
}

function resolveWorktreeContext(
  explicitWorktreePath: string | null,
): { worktreePath: string | undefined; block: string } {
  if (explicitWorktreePath === null) {
    return { worktreePath: undefined, block: "" }
  }

  const validatedPath = detectWorktreePath(explicitWorktreePath)
  if (validatedPath) {
    return { worktreePath: validatedPath, block: createWorktreeActiveBlock(validatedPath) }
  }

  return {
    worktreePath: undefined,
    block: `\n**Worktree** (needs setup): \`git worktree add ${explicitWorktreePath} <branch>\`, then add \`"worktree_path"\` to boulder.json`,
  }
}

export function createStartWorkHook(ctx: PluginInput) {
  const processStartWork = async (
    input: StartWorkHookInput,
    output: StartWorkHookOutput,
  ): Promise<void> => {
    const parts = output.parts
    const promptText =
      parts
        ?.filter((p) => p.type === "text" && p.text)
        .map((p) => p.text)
        .join("\n")
        .trim() || ""

    if (
      !promptText.includes("<session-context>")
      || !promptText.includes(START_WORK_TEMPLATE_MARKER)
    ) {
      return
    }

    log(`[${HOOK_NAME}] Processing start-work command`, { sessionID: input.sessionID })
    const activeAgent = isAgentRegistered("atlas")
      ? "atlas"
      : "sisyphus"
    updateSessionAgent(input.sessionID, activeAgent)
    if (output.message) {
      output.message["agent"] = resolveRegisteredAgentName(activeAgent) ?? activeAgent
    }

    const existingState = readBoulderState(ctx.directory)
    const sessionId = normalizeSessionId(input.sessionID, "opencode")
    const timestamp = new Date().toISOString()

    const { planName: explicitPlanName, explicitWorktreePath } = parseUserRequest(promptText)
    const { worktreePath, block: worktreeBlock } = resolveWorktreeContext(explicitWorktreePath)
    const preferredPlanPath = explicitPlanName
      ? null
      : await findRecentSessionPlanPath({
          client: ctx.client,
          directory: ctx.directory,
          sessionID: sessionId,
          availablePlans: findPrometheusPlans(ctx.directory),
        })

    const contextInfo = buildStartWorkContextInfo({
      ctx,
      explicitPlanName,
      existingState,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      preferredPlanPath,
    })

    // Substitute placeholders across every text part: on an error-retry path
    // OpenCode may re-issue the original template alongside the already-
    // processed text, leaving a second <session-context> block with un-
    // substituted $SESSION_ID / $TIMESTAMP literals (#4480).
    let firstTextIdx = -1
    let contextAlreadyInjected = false
    for (let i = 0; i < output.parts.length; i++) {
      const part = output.parts[i]
      if (part.type !== "text" || !part.text) continue
      part.text = part.text
        .replace(/\$SESSION_ID/g, sessionId)
        .replace(/\$TIMESTAMP/g, timestamp)
      if (part.text.includes(CONTEXT_INFO_MARKER)) {
        contextAlreadyInjected = true
      }
      if (firstTextIdx < 0) firstTextIdx = i
    }

    // Marker-guarded append: keeps the hook idempotent when it fires more than
    // once for the same session (e.g. command.execute.before + chat.message,
    // or retry-driven re-firings).
    if (!contextAlreadyInjected && firstTextIdx >= 0) {
      output.parts[firstTextIdx].text += `\n\n---\n${CONTEXT_INFO_MARKER}\n${contextInfo}`
    }

    log(`[${HOOK_NAME}] Context injected`, {
      sessionID: input.sessionID,
      hasExistingState: !!existingState,
      preferredPlanPath,
      worktreePath,
    })
  }

  return {
    "chat.message": async (input: StartWorkHookInput, output: StartWorkHookOutput): Promise<void> => {
      await processStartWork(input, output)
    },
    "command.execute.before": async (
      input: StartWorkCommandExecuteBeforeInput,
      output: StartWorkHookOutput,
    ): Promise<void> => {
      await processStartWork(input, output)
    },
  }
}
