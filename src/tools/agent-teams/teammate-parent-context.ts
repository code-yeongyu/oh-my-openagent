import type { ParentContext } from "../delegate-task/executor"
import { resolveParentContext } from "../delegate-task/executor"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import type { TeamToolContext } from "./types"

export function buildTeamParentToolContext(context: TeamToolContext): ToolContextWithMetadata {
  return {
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent,
    abort: context.abort ?? new AbortController().signal,
  }
}

export function resolveTeamParentContext(context: TeamToolContext): ParentContext {
  return resolveParentContext(buildTeamParentToolContext(context))
}
