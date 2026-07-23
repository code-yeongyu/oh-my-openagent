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
import { createPrDeliveryBlock, createWorktreeActiveBlock } from "./worktree-block"
import { findRecentSessionPlanPath } from "./session-plan-affinity"

export const HOOK_NAME = "start-work" as const
const START_WORK_TEMPLATE_MARKER = "You are starting an Atlas work session."
const CONTEXT_INFO_MARKER = "<!-- omo-start-work-context -->"
const COMMAND_INSTRUCTION_OPEN = "<command-instruction>"
const COMMAND_INSTRUCTION_CLOSE = "</command-instruction>"
const SESSION_CONTEXT_OPEN = "<session-context>"
const SESSION_CONTEXT_CLOSE = "</session-context>"
const RUNTIME_PLACEHOLDER_PATTERN = /\$SESSION_ID|\$TIMESTAMP/g

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

type TextPart = StartWorkHookOutput["parts"][number]

interface TextEntry {
  readonly part: TextPart
  readonly text: string
  readonly start: number
  readonly end: number
}

interface TextRange {
  readonly start: number
  readonly end: number
}

function findFrameworkSessionContextRanges(text: string): readonly TextRange[] {
  const ranges: TextRange[] = []
  let searchFrom = 0

  while (searchFrom < text.length) {
    const markerIndex = text.indexOf(START_WORK_TEMPLATE_MARKER, searchFrom)
    if (markerIndex < 0) break

    const instructionOpen = text.lastIndexOf(COMMAND_INSTRUCTION_OPEN, markerIndex)
    const instructionBodyStart = instructionOpen + COMMAND_INSTRUCTION_OPEN.length
    const instructionClose = text.indexOf(
      COMMAND_INSTRUCTION_CLOSE,
      markerIndex + START_WORK_TEMPLATE_MARKER.length,
    )
    if (
      instructionOpen < searchFrom
      || instructionClose < 0
      || text.slice(instructionBodyStart, markerIndex).trim() !== ""
    ) {
      searchFrom = markerIndex + START_WORK_TEMPLATE_MARKER.length
      continue
    }

    const instructionEnd = instructionClose + COMMAND_INSTRUCTION_CLOSE.length
    const contextOpen = text.indexOf(SESSION_CONTEXT_OPEN, instructionEnd)
    if (contextOpen < 0 || text.slice(instructionEnd, contextOpen).trim() !== "") {
      searchFrom = instructionEnd
      continue
    }

    const contextBodyStart = contextOpen + SESSION_CONTEXT_OPEN.length
    const contextClose = text.indexOf(SESSION_CONTEXT_CLOSE, contextBodyStart)
    if (contextClose < 0) {
      searchFrom = contextBodyStart
      continue
    }

    ranges.push({ start: contextBodyStart, end: contextClose })
    searchFrom = contextClose + SESSION_CONTEXT_CLOSE.length
  }

  return ranges
}

function substituteSessionContextPlaceholders(
  parts: TextPart[],
  sessionId: string,
  timestamp: string,
): void {
  let offset = 0
  const entries: TextEntry[] = []
  for (const part of parts) {
    if (part.type !== "text" || !part.text) continue
    entries.push({ part, text: part.text, start: offset, end: offset + part.text.length })
    offset += part.text.length
  }

  const combinedText = entries.map((entry) => entry.text).join("")
  const ranges = findFrameworkSessionContextRanges(combinedText)

  for (const entry of entries) {
    let cursor = 0
    let substituted = ""
    for (const range of ranges) {
      const overlapStart = Math.max(entry.start, range.start)
      const overlapEnd = Math.min(entry.end, range.end)
      if (overlapStart >= overlapEnd) continue

      const localStart = overlapStart - entry.start
      const localEnd = overlapEnd - entry.start
      substituted += entry.text.slice(cursor, localStart)
      substituted += entry.text.slice(localStart, localEnd).replace(
        RUNTIME_PLACEHOLDER_PATTERN,
        (placeholder) => placeholder === "$SESSION_ID" ? sessionId : timestamp,
      )
      cursor = localEnd
    }
    entry.part.text = substituted + entry.text.slice(cursor)
  }
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

    const { planName: explicitPlanName, explicitWorktreePath, makePr, ship } = parseUserRequest(promptText)
    const { worktreePath, block } = resolveWorktreeContext(explicitWorktreePath)
    const worktreeBlock = block + createPrDeliveryBlock({ makePr, ship }, worktreePath)
    const preferredPlanPath = explicitPlanName
      ? null
      : await findRecentSessionPlanPath({
          client: ctx.client,
          directory: ctx.directory,
          // SDK session.messages needs the bare ses_ id, not the opencode:-prefixed storage id (#5285)
          sessionID: input.sessionID,
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

    // Substitute placeholders in every raw session-context region: on an
    // error-retry path OpenCode may re-issue the original template alongside
    // the already-processed text (#4480).
    let firstTextIdx = -1
    let contextAlreadyInjected = false
    substituteSessionContextPlaceholders(output.parts, sessionId, timestamp)
    for (let i = 0; i < output.parts.length; i++) {
      const part = output.parts[i]
      if (part.type !== "text" || !part.text) continue
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
