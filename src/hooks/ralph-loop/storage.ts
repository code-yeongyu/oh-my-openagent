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
    const { data, body } = parseFrontmatter<Partial<RalphLoopState> & Record<string, unknown>>(content)

    if (typeof data.active !== "boolean" || typeof data.iteration !== "number") {
      return null
    }

    return {
      active: data.active,
      iteration: Number(data.iteration),
      max_iterations: Number(data.max_iterations) || DEFAULT_MAX_ITERATIONS,
      completion_promise: String(data.completion_promise || DEFAULT_COMPLETION_PROMISE).replace(/^["']|["']$/g, ""),
      started_at: String(data.started_at || new Date().toISOString()).replace(/^["']|["']$/g, ""),
      prompt: body.trim(),
      session_id: data.session_id ? String(data.session_id).replace(/^["']|["']$/g, "") : undefined,
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
    const content = `---
active: ${state.active}
iteration: ${state.iteration}
max_iterations: ${state.max_iterations}
completion_promise: "${state.completion_promise}"
started_at: "${state.started_at}"
${sessionIdLine}---
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
