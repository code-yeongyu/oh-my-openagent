import type { RalphLoopMode } from "./types"

export interface ParsedLoopCommandArgs {
  prompt: string
  maxIterations?: number
  completionPromise?: string
  hasExplicitCompletionPromise: boolean
  maxDurationMs?: number
}

export const DEFAULT_AUDIT_LOOP_DURATION_MS = 3 * 60 * 60 * 1000
export const DEFAULT_AUDIT_LOOP_MAX_ITERATIONS = 100
export const MAX_LOOP_DURATION_MS = 24 * 60 * 60 * 1000

const MAX_ITERATIONS_PATTERN = /--max-iterations=(\d+)/i
const COMPLETION_PROMISE_PATTERN = /--completion-promise=(?:"([^"]+)"|'([^']+)'|([^\s]+))/i
const MAX_DURATION_PATTERN = /--max-duration=([^\s]+)/i
const DURATION_PATTERN = /^(\d+)([smh])$/i

function parseDurationToMs(raw: string): number {
  const match = raw.trim().match(DURATION_PATTERN)
  if (!match) {
    throw new Error(
      `Invalid --max-duration value "${raw}". Use formats like 30m, 2h, or 3600s.`
    )
  }

  const value = Number(match[1])
  const unit = match[2].toLowerCase()
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`Invalid --max-duration value "${raw}". Duration must be greater than 0.`)
  }

  const multiplier =
    unit === "h" ? 60 * 60 * 1000 : unit === "m" ? 60 * 1000 : 1000
  const ms = value * multiplier
  if (ms > MAX_LOOP_DURATION_MS) {
    throw new Error(
      `Invalid --max-duration value "${raw}". Maximum allowed duration is 24h.`
    )
  }

  return ms
}

export function extractRawLoopArgs(rawCommand: string | undefined, commandName: string): string {
  if (!rawCommand) return ""
  const pattern = new RegExp(`^/?(${commandName})\\s*`, "i")
  return rawCommand.replace(pattern, "")
}

export function parseLoopCommandArgs(
  rawArgs: string,
  options?: { defaultPrompt?: string; mode?: RalphLoopMode }
): ParsedLoopCommandArgs {
  const defaultPrompt = options?.defaultPrompt ?? "Complete the task as instructed"
  const trimmed = rawArgs.trim()
  const taskMatch = trimmed.match(/^["']([\s\S]*?)["']/)
  const prompt =
    taskMatch?.[1] ??
    trimmed.split(/\s+--/)[0]?.trim() ??
    defaultPrompt

  const parsed: ParsedLoopCommandArgs = {
    prompt: prompt || defaultPrompt,
    hasExplicitCompletionPromise: false,
  }

  const maxIterMatch = rawArgs.match(MAX_ITERATIONS_PATTERN)
  if (maxIterMatch) {
    parsed.maxIterations = Number.parseInt(maxIterMatch[1], 10)
  } else if (options?.mode === "audit-loop") {
    parsed.maxIterations = DEFAULT_AUDIT_LOOP_MAX_ITERATIONS
  }

  const promiseMatch = rawArgs.match(COMPLETION_PROMISE_PATTERN)
  if (promiseMatch) {
    parsed.completionPromise = promiseMatch[1] ?? promiseMatch[2] ?? promiseMatch[3]
    parsed.hasExplicitCompletionPromise = true
  }

  const durationMatch = rawArgs.match(MAX_DURATION_PATTERN)
  if (durationMatch) {
    parsed.maxDurationMs = parseDurationToMs(durationMatch[1])
  } else if (options?.mode === "audit-loop") {
    parsed.maxDurationMs = DEFAULT_AUDIT_LOOP_DURATION_MS
  }

  return parsed
}
