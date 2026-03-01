import { existsSync, readFileSync, unlinkSync, readdirSync, renameSync, mkdirSync } from "node:fs"
import { dirname, join } from "node:path"
import { parseFrontmatter } from "../../shared/frontmatter"
import { atomicWriteText } from "../../features/boulder-state/atomic-file-ops"
import type { RalphLoopState } from "./types"
import { DEFAULT_STATE_FILE, DEFAULT_COMPLETION_PROMISE, DEFAULT_MAX_ITERATIONS, RALPH_LOOP_SESSIONS_DIR } from "./constants"

export function getStateFilePath(directory: string, customPath?: string): string {
  return customPath
    ? join(directory, customPath)
    : join(directory, DEFAULT_STATE_FILE)
}

export function getSessionStateFilePath(directory: string, sessionId: string): string {
  return join(directory, RALPH_LOOP_SESSIONS_DIR, `${sessionId}.local.md`)
}

export function readState(directory: string, customPath?: string, sessionId?: string): RalphLoopState | null {
  const filePath = customPath
    ? getStateFilePath(directory, customPath)
    : sessionId
      ? getSessionStateFilePath(directory, sessionId)
      : getStateFilePath(directory)

  return readStateFromPath(filePath)
}

export function readStateForSession(directory: string, sessionId: string): RalphLoopState | null {
  return readStateFromPath(getSessionStateFilePath(directory, sessionId))
}

export function writeState(
  directory: string,
  state: RalphLoopState,
  customPath?: string,
  sessionId?: string,
): boolean {
  const filePath = customPath
    ? getStateFilePath(directory, customPath)
    : sessionId
      ? getSessionStateFilePath(directory, sessionId)
      : getStateFilePath(directory)

  return writeStateToPath(filePath, state)
}

export function clearState(directory: string, customPath?: string, sessionId?: string): boolean {
  const filePath = customPath
    ? getStateFilePath(directory, customPath)
    : sessionId
      ? getSessionStateFilePath(directory, sessionId)
      : getStateFilePath(directory)

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
  customPath?: string,
  sessionId?: string,
): RalphLoopState | null {
  const state = readState(directory, customPath, sessionId)
  if (!state) return null

  state.iteration += 1
  if (writeState(directory, state, customPath, sessionId)) {
    return state
  }
  return null
}

export function migrateLegacyRalphLoopState(directory: string): void {
  const legacyPath = join(directory, DEFAULT_STATE_FILE)
  if (!existsSync(legacyPath)) return

  const state = readStateFromPath(legacyPath)
  if (!state || !state.session_id) {
    try { unlinkSync(legacyPath) } catch { /* stale file removal is best-effort */ }
    return
  }

  const sessionPath = getSessionStateFilePath(directory, state.session_id)
  const sessionDir = dirname(sessionPath)
  if (!existsSync(sessionDir)) {
    mkdirSync(sessionDir, { recursive: true })
  }

  try {
    renameSync(legacyPath, sessionPath)
  } catch {
    try { unlinkSync(legacyPath) } catch { /* cleanup is best-effort */ }
  }
}

export function findActiveRalphLoopState(directory: string, excludeSessionId?: string): RalphLoopState | null {
  const sessionsDir = join(directory, RALPH_LOOP_SESSIONS_DIR)
  if (!existsSync(sessionsDir)) return null

  try {
    const files = readdirSync(sessionsDir).filter((f) => f.endsWith(".local.md"))
    for (const file of files) {
      const state = readStateFromPath(join(sessionsDir, file))
      if (state?.active && (!excludeSessionId || state.session_id !== excludeSessionId)) {
        return state
      }
    }
  } catch {
    return null
  }

  return null
}

export function findAnyActiveRalphLoopState(directory: string): RalphLoopState | null {
  return findActiveRalphLoopState(directory)
}

export function findSecondActiveRalphLoopState(directory: string, excludeSessionId: string): RalphLoopState | null {
  return findActiveRalphLoopState(directory, excludeSessionId)
}

function readStateFromPath(filePath: string): RalphLoopState | null {
  if (!existsSync(filePath)) return null

  try {
    const content = readFileSync(filePath, "utf-8")
    const { data, body } = parseFrontmatter<Record<string, unknown>>(content)

    const active = data.active
    const iteration = data.iteration

    if (active === undefined || iteration === undefined) return null

    const isActive = active === true || active === "true"
    const iterationNum = typeof iteration === "number" ? iteration : Number(iteration)

    if (isNaN(iterationNum)) return null

    const stripQuotes = (val: unknown): string => {
      const str = String(val ?? "")
      return str.replace(/^["']|["']$/g, "")
    }

    return {
      active: isActive,
      iteration: iterationNum,
      max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
      message_count_at_start:
        typeof data.message_count_at_start === "number"
          ? data.message_count_at_start
          : typeof data.message_count_at_start === "string" && data.message_count_at_start.trim() !== ""
            ? Number(data.message_count_at_start)
            : undefined,
      completion_promise: stripQuotes(data.completion_promise) || DEFAULT_COMPLETION_PROMISE,
      started_at: stripQuotes(data.started_at) || new Date().toISOString(),
      prompt: body.trim(),
      session_id: data.session_id ? stripQuotes(data.session_id) : undefined,
      ultrawork: data.ultrawork === true || data.ultrawork === "true" ? true : undefined,
      strategy: data.strategy === "reset" || data.strategy === "continue" ? data.strategy : undefined,
    }
  } catch {
    return null
  }
}

function writeStateToPath(filePath: string, state: RalphLoopState): boolean {
  try {
    const sessionIdLine = state.session_id ? `session_id: "${state.session_id}"\n` : ""
    const ultraworkLine = state.ultrawork !== undefined ? `ultrawork: ${state.ultrawork}\n` : ""
    const strategyLine = state.strategy ? `strategy: "${state.strategy}"\n` : ""
    const messageCountAtStartLine =
      typeof state.message_count_at_start === "number"
        ? `message_count_at_start: ${state.message_count_at_start}\n`
        : ""
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
started_at: "${state.started_at}"
${sessionIdLine}${ultraworkLine}${strategyLine}${messageCountAtStartLine}---
${state.prompt}
`

    atomicWriteText(filePath, content)
    return true
  } catch {
    return false
  }
}
