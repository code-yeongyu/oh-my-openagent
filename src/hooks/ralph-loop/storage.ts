import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import type { RalphLoopState } from "./types"
import { DEFAULT_STATE_FILE, DEFAULT_COMPLETION_PROMISE, DEFAULT_MAX_ITERATIONS } from "./constants"

export function getStateFilePath(directory: string, customPath?: string): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE)
}

export function readState(directory: string, customPath?: string): RalphLoopState | null {
  const filePath = getStateFilePath(directory, customPath)

  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration
    
    if (active === undefined || iteration === undefined) {
      return null
    }

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)
    
    if (isNaN(iterationNum)) {
      return null
    }

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    const ultrawork = data.ultrawork === true || data.ultrawork === "true" ? true : undefined
    const maxIterations =
      data.max_iterations === undefined || data.max_iterations === ""
        ? ultrawork
          ? undefined
          : DEFAULT_MAX_ITERATIONS
        : Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: maxIterations,
      message_count_at_start:
        typeof data.message_count_at_start === "number"
          ? data.message_count_at_start
          : typeof data.message_count_at_start === "string" && data.message_count_at_start.trim() !== ""
            ? Number(data.message_count_at_start)
            : undefined,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      initial_completion_promise: data.initial_completion_promise
        ? stripQuotes(data.initial_completion_promise)
        : undefined,
      verification_attempt_id: data.verification_attempt_id
        ? stripQuotes(data.verification_attempt_id)
        : undefined,
      verification_session_id: data.verification_session_id
        ? stripQuotes(data.verification_session_id)
        : undefined,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork,
      verification_pending:
        data.verification_pending === true || data.verification_pending === "true"
          ? true
          : undefined,
      strategy: data.strategy === "reset" || data.strategy === "continue" ? data.strategy : undefined,
    }
  } catch {
    return null
  }
}

export function writeState(
  directory: string,
  state: RalphLoopState,
  customPath?: string
): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    const dir = dirname(filePath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
    const ultraworkLine = state.ultrawork !== undefined ? `ultrawork: ${state.ultrawork}\n` : ""
    const verificationPendingLine =
      state.verification_pending !== undefined
        ? `verification_pending: ${state.verification_pending}\n`
        : ""
    const strategyLine = state.strategy ? `strategy: "${state.strategy}"\n` : ""
    const initialCompletionPromiseLine = state.initial_completion_promise
      ? `initial_completion_promise: "${state.initial_completion_promise}"\n`
      : ""
    const verificationAttemptLine = state.verification_attempt_id
      ? `verification_attempt_id: "${state.verification_attempt_id}"\n`
      : ""
    const verificationSessionLine = state.verification_session_id
      ? `verification_session_id: "${state.verification_session_id}"\n`
      : ""
    const messageCountAtStartLine =
      typeof state.message_count_at_start === "number"
        ? `message_count_at_start: ${state.message_count_at_start}\n`
        : ""
    const maxIterationsLine =
      typeof state.max_iterations === "number"
        ? `max_iterations: ${state.max_iterations}\n`
        : ""
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
${maxIterationsLine}completion_promise: "${state.completion_promise}"
${initialCompletionPromiseLine}${verificationAttemptLine}${verificationSessionLine}started_at: "${state.started_at}"
${sessionIdLine}${ultraworkLine}${verificationPendingLine}${strategyLine}${messageCountAtStartLine}---
${state.prompt}
`

    writeFileSync(filePath, content, "utf-8")
    return true
  } catch {
    return false
  }
}

export function clearState(directory: string, customPath?: string): boolean {
  const filePath = getStateFilePath(directory, customPath)

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
    return true
  } catch {
    return false
  }
}

export function incrementIteration(
  directory: string,
  customPath?: string
): RalphLoopState | null {
  const state = readState(directory, customPath)
  if (!state) return null

  state.iteration += 1
  if (writeState(directory, state, customPath)) {
    return state
  }
  return null
}
