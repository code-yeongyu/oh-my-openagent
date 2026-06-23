import type { Hooks } from "@opencode-ai/plugin"

import {
  getMainSessionID,
  subagentSessions,
  syncSubagentSessions,
} from "../../features/claude-code-session-state"
import { lookupTeamSession } from "../../features/team-mode/team-session-registry"
import { isRecord, log, normalizeSDKResponse } from "../../shared"
import {
  isBtwMarked,
  type MessageRole,
  type MessageWithParts,
} from "../btw-context-strip/predicates"

export const BTW_TOOL_GUARD_DENIAL_MESSAGE = "/btw side questions are read-only and cannot use tools."

export type BtwToolGuardClient = {
  session: {
    get?: (input: { path: { id: string } }) => Promise<unknown>
    messages: (input: { path: { id: string } }) => Promise<unknown>
  }
}

export type BtwToolGuardDeps = {
  client: BtwToolGuardClient
}

type ToolExecuteBeforeInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteBeforeOutput = {
  args: Record<string, unknown>
}

const MESSAGE_ROLES = new Set<MessageRole>(["user", "assistant", "tool"])

function isMessageRole(value: unknown): value is MessageRole {
  return typeof value === "string" && MESSAGE_ROLES.has(value as MessageRole)
}

function isMessageWithParts(value: unknown): value is MessageWithParts {
  if (!isRecord(value) || !isRecord(value.info)) {
    return false
  }

  return isMessageRole(value.info.role) && Array.isArray(value.parts)
}

function normalizeSessionMessages(response: unknown): MessageWithParts[] {
  const rawMessages = normalizeSDKResponse<unknown>(response, [], {
    preferResponseOnMissingData: true,
  })
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages.filter(isMessageWithParts)
}

function findLatestUserMessage(messages: MessageWithParts[]): MessageWithParts | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.info.role === "user") {
      return message
    }
  }

  return undefined
}

function hasParentSession(response: unknown): boolean {
  const sessionInfo = normalizeSDKResponse<unknown>(response, null, {
    preferResponseOnMissingData: true,
  })
  if (!isRecord(sessionInfo)) {
    return false
  }

  return typeof sessionInfo.parentID === "string" && sessionInfo.parentID.length > 0
}

async function isPrimaryInteractiveSession(deps: BtwToolGuardDeps, sessionID: string): Promise<boolean> {
  if (subagentSessions.has(sessionID) || syncSubagentSessions.has(sessionID)) {
    return false
  }

  if (lookupTeamSession(sessionID)) {
    return false
  }

  const mainSessionID = getMainSessionID()
  if (mainSessionID && mainSessionID !== sessionID) {
    return false
  }

  const getSession = deps.client.session.get
  if (!getSession) {
    return true
  }

  try {
    const response = await getSession({ path: { id: sessionID } })
    return !hasParentSession(response)
  } catch (error) {
    log("[btw-tool-guard] Failed to resolve session metadata", {
      sessionID,
      error: String(error),
    })
    return true
  }
}

async function isBtwAnswerTurn(deps: BtwToolGuardDeps, sessionID: string): Promise<boolean> {
  try {
    const response = await deps.client.session.messages({ path: { id: sessionID } })
    const latestUserMessage = findLatestUserMessage(normalizeSessionMessages(response))
    return latestUserMessage ? isBtwMarked(latestUserMessage) : false
  } catch (error) {
    log("[btw-tool-guard] Failed to resolve session messages", {
      sessionID,
      error: String(error),
    })
    return false
  }
}

export function createBtwToolGuardHook(deps: BtwToolGuardDeps): Hooks {
  return {
    "tool.execute.before": async (
      input: ToolExecuteBeforeInput,
      _output: ToolExecuteBeforeOutput,
    ): Promise<void> => {
      if (!await isPrimaryInteractiveSession(deps, input.sessionID)) {
        return
      }

      if (!await isBtwAnswerTurn(deps, input.sessionID)) {
        return
      }

      throw new Error(BTW_TOOL_GUARD_DENIAL_MESSAGE)
    },
  }
}
