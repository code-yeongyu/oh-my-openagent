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

function normalizeFingerprintPart(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim()
}

function stableFingerprint(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `${value.length}:${(hash >>> 0).toString(16)}`
}

function getBashProgressFingerprint(output: ToolProgressOutput): string {
  const title = normalizeFingerprintPart(output.title ?? "")
  const body = normalizeFingerprintPart(output.output ?? "")
  return stableFingerprint(`title:${title}\noutput:${body}`)
}

export function recordToolProgress(state: SessionState, now = Date.now()): void {
  state.awaitingToolProgressAfterContinuation = false
  state.iterationsSinceLastToolProgress = 0
  state.lastToolProgressAt = now
  state.lastBashProgressFingerprint = undefined
  state.stalledContinuationReason = undefined
  state.stalledContinuationPlanPath = undefined
}

export function recordTangibleToolProgress(
  state: SessionState,
  toolName: string,
  output: ToolProgressOutput,
  now = Date.now(),
): boolean {
  const normalizedToolName = toolName.toLowerCase()
  if (!isTangibleProgressTool(normalizedToolName) || !didToolMakeProgress(output)) {
    return false
  }

  if (normalizedToolName !== "bash") {
    recordToolProgress(state, now)
    return true
  }

  const fingerprint = getBashProgressFingerprint(output)
  if (state.lastBashProgressFingerprint === fingerprint) {
    return false
  }

  recordToolProgress(state, now)
  state.lastBashProgressFingerprint = fingerprint
  return true
}

export function resetStallStateForPlanChange(state: SessionState, planPath: string): void {
  const previousPlanPath = state.activeContinuationPlanPath
  if (previousPlanPath === undefined) {
    state.activeContinuationPlanPath = planPath
    state.lastBashProgressFingerprint = undefined
    return
  }
  if (previousPlanPath === planPath) {
    return
  }

  state.activeContinuationPlanPath = planPath
  state.iterationsSinceLastToolProgress = 0
  state.awaitingToolProgressAfterContinuation = false
  state.lastBashProgressFingerprint = undefined
  if (state.stalledContinuationReason && state.stalledContinuationPlanPath !== planPath) {
    state.stalledContinuationReason = undefined
    state.stalledContinuationPlanPath = undefined
  }
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

export function markContinuationStalled(state: SessionState, planName: string, planPath: string): void {
  state.stalledContinuationReason = `Boulder continuation stalled for plan "${planName}": ${MAX_BOULDER_CONTINUATION_NO_TOOL_PROGRESS} consecutive continuation iterations produced no successful bash/edit/write tool progress.`
  state.stalledContinuationPlanPath = planPath
}
