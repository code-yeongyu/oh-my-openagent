import { statSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  readBoulderState,
  writeBoulderState,
  appendSessionId,
  findPrometheusPlans,
  getPlanProgress,
  createBoulderState,
  getPlanName,
  clearBoulderState,
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

export const HOOK_NAME = "start-work" as const
const START_WORK_TEMPLATE_MARKER = "You are starting a Sisyphus work session."

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
    const sessionId = input.sessionID
    const timestamp = new Date().toISOString()

    const { planName: explicitPlanName, explicitWorktreePath } = parseUserRequest(promptText)
    const { worktreePath, block: worktreeBlock } = resolveWorktreeContext(explicitWorktreePath)

    const contextInfo = buildStartWorkContextInfo({
      ctx,
      explicitPlanName,
      existingState,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
    })

    const idx = output.parts.findIndex((p) => p.type === "text" && p.text)
    if (idx >= 0 && output.parts[idx].text) {
      output.parts[idx].text = output.parts[idx].text
        .replace(/\$SESSION_ID/g, sessionId)
        .replace(/\$TIMESTAMP/g, timestamp)

      output.parts[idx].text += `\n\n---\n${contextInfo}`
    }

    log(`[${HOOK_NAME}] Context injected`, {
      sessionID: input.sessionID,
      hasExistingState: !!existingState,
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
