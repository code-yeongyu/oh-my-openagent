import type { ParentContext } from "../delegate-task/executor"
import { resolveParentContext } from "../delegate-task/executor"
import type { ToolContextWithMetadata } from "../delegate-task/types"
import type { TeamToolContext } from "./types"

export function resolveTeamParentContext(context: TeamToolContext): ParentContext {
  return resolveParentContext({
    sessionID: context.sessionID,
    messageID: context.messageID,
    agent: context.agent ?? "sisyphus",
    abort: new AbortController().signal,
  } as ToolContextWithMetadata)
}
