import type { EventState } from "./event-state"
import { getSessionId } from "./event-session-ids"
import { closeThinkBlockIfNeeded } from "./event-think-block"
import { writeToolHeader, writeToolOutput } from "./event-tool-output"
import type { EventPayload, RunContext, ToolExecuteProps, ToolResultProps } from "./types"

export function handleToolExecute(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.execute") return

  const props = payload.properties as ToolExecuteProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  closeThinkBlockIfNeeded(state)

  if (state.currentTool !== null) return

  const toolName = props?.name || "unknown"
  state.currentTool = toolName
  state.mainSessionStarted = true
  state.hasReceivedMeaningfulWork = true
  writeToolHeader(toolName, props?.input ?? {})
}

export function handleToolResult(ctx: RunContext, payload: EventPayload, state: EventState): void {
  if (payload.type !== "tool.result") return

  const props = payload.properties as ToolResultProps | undefined
  if (getSessionId(props) !== ctx.sessionID) return

  closeThinkBlockIfNeeded(state)

  if (state.currentTool === null) return

  writeToolOutput(props?.output || "")
  state.currentTool = null
  state.lastPartText = ""
  state.textAtLineStart = true
}
