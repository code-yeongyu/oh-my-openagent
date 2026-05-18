import type { SessionState } from "./types"

const TANGIBLE_PROGRESS_TOOLS = new Set([
  "bash",
  "edit",
  "write",
])

const FAILURE_TITLE_PATTERN = /(?:\berror\b|\bfailed\b|\bfailure\b|\bdenied\b|\brejected\b)/i
const FAILURE_OUTPUT_PATTERN = /^\s*(?:error|failed|failure|denied|rejected)\b/i

export const MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS = 3

export type ToolProgressOutput = {
  title?: string
  output?: string
}

export function isTangibleProgressTool(toolName: string): boolean {
  return TANGIBLE_PROGRESS_TOOLS.has(toolName.toLowerCase())
}

export function didToolMakeProgress(output: ToolProgressOutput): boolean {
  const title = output.title ?? ""
  const body = output.output ?? ""
  return !FAILURE_TITLE_PATTERN.test(title) && !FAILURE_OUTPUT_PATTERN.test(body)
}

export function recordToolProgress(state: SessionState, now = Date.now()): void {
  state.awaitingToolProgressAfterContinuation = false
  state.iterationsSinceLastToolProgress = 0
  state.lastToolProgressAt = now
  state.stalledContinuationReason = undefined
}

export function markContinuationInjectedAwaitingToolProgress(state: SessionState): void {
  state.awaitingToolProgressAfterContinuation = true
}

export function updateNoToolProgressIterations(state: SessionState): number {
  if (!state.awaitingToolProgressAfterContinuation) {
    return state.iterationsSinceLastToolProgress ?? 0
  }

  state.awaitingToolProgressAfterContinuation = false
  state.iterationsSinceLastToolProgress = (state.iterationsSinceLastToolProgress ?? 0) + 1
  return state.iterationsSinceLastToolProgress
}

export function shouldAbortForNoToolProgress(state: SessionState): boolean {
  return (state.iterationsSinceLastToolProgress ?? 0) >= MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS
}

export function markContinuationStalled(state: SessionState, planName: string): void {
  state.stalledContinuationReason = `Boulder continuation stalled for plan "${planName}": ${MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS} consecutive continuation iterations produced no successful bash/edit/write tool progress.`
}
