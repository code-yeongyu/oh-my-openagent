import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"

import { log } from "../../shared/logger"
import {
  HOOK_NAME,
  NOTEPAD_DIR_NAME,
  NOTEPAD_EXTENSION,
  PLAN_DIR_NAME,
  PLAN_EXTENSION,
  PLANS_SUBDIR,
  TASK_NOTEPAD_FRAGMENT,
  TASKS_SUBDIR,
  TODO_FETCH_ERROR_FRAGMENT,
  TODO_TOOL_NAMES,
} from "./constants"
import type { PlanFile, TaskNotepadContext, TodoSnapshot } from "./types"

export function createTaskNotepadHook(ctx: TaskNotepadContext) {
  return {
    "tool.execute.after": async (
      input: { tool: string; sessionID: string; callID: string },
      output: { title: string; output: string; metadata: Record<string, unknown> } | undefined,
    ): Promise<void> => {
      if (!output) return
      if (!TODO_TOOL_NAMES.has(input.tool)) return

      const todos = await fetchTodos(ctx, input.sessionID)
      const inProgress = todos.find((t) => t.status === "in_progress")
      const completed = todos.filter((t) => t.status === "completed")
      if (!inProgress && completed.length === 0) return

      const plan = resolveActivePlan(ctx.directory)
      if (inProgress) {
        if (!plan) {
          log(`[${HOOK_NAME}] No active plan, skipping notepad creation`, {
            sessionID: input.sessionID,
          })
        } else {
          ensureNotepad(ctx.directory, plan.name, inProgress)
        }
      }

      if (!plan) return
      for (const done of completed) {
        appendCompletion(ctx.directory, plan.name, done)
      }
    },
  }
}

async function fetchTodos(ctx: TaskNotepadContext, sessionID: string): Promise<TodoSnapshot[]> {
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    const payload = response as { data?: unknown }
    if (Array.isArray(payload?.data)) {
      return payload.data as TodoSnapshot[]
    }
    if (Array.isArray(response)) {
      return response as unknown as TodoSnapshot[]
    }
    return []
  } catch (err) {
    log(`[${HOOK_NAME}] ${TODO_FETCH_ERROR_FRAGMENT}`, {
      sessionID,
      error: String(err),
    })
    return []
  }
}

function resolveActivePlan(directory: string): PlanFile | null {
  const plansDir = join(directory, PLAN_DIR_NAME, PLANS_SUBDIR)
  if (!existsSync(plansDir)) return null

  let entries: string[]
  try {
    entries = readdirSync(plansDir)
  } catch {
    return null
  }

  let best: PlanFile | null = null
  for (const entry of entries) {
    if (!entry.endsWith(PLAN_EXTENSION)) continue
    const fullPath = join(plansDir, entry)
    try {
      const stats = statSync(fullPath)
      if (!stats.isFile()) continue
      const candidate: PlanFile = {
        name: entry.slice(0, -PLAN_EXTENSION.length),
        path: fullPath,
        mtimeMs: stats.mtimeMs,
      }
      if (!best || candidate.mtimeMs > best.mtimeMs) {
        best = candidate
      }
    } catch {
    }
  }
  return best
}

function ensureNotepad(directory: string, planName: string, todo: TodoSnapshot): void {
  const notepadPath = notepadPathFor(directory, planName, todo.id)
  if (existsSync(notepadPath)) return

  mkdirSync(dirname(notepadPath), { recursive: true })
  const content = renderNotepad(todo)
  writeFileSync(notepadPath, content, "utf-8")
  log(`[${HOOK_NAME}] Created task notepad`, { plan: planName, taskID: todo.id })
}

function appendCompletion(directory: string, planName: string, todo: TodoSnapshot): void {
  const notepadPath = notepadPathFor(directory, planName, todo.id)
  if (!existsSync(notepadPath)) return
  const existing = readFileSync(notepadPath, "utf-8")
  if (existing.includes("**Status**: completed")) return
  const stamp = new Date().toISOString()
  const updated = `${existing}\n## Completion\n- completed_at: ${stamp}\n- status: completed\n`
  writeFileSync(notepadPath, updated, "utf-8")
  log(`[${HOOK_NAME}] Appended completion to notepad`, { plan: planName, taskID: todo.id })
}

function notepadPathFor(directory: string, planName: string, taskID: string): string {
  return join(
    directory,
    PLAN_DIR_NAME,
    NOTEPAD_DIR_NAME,
    planName,
    TASKS_SUBDIR,
    `${taskID}${NOTEPAD_EXTENSION}`,
  )
}

function renderNotepad(todo: TodoSnapshot): string {
  const priority = todo.priority ?? "medium"
  return `# Task: ${todo.content}

**Plan**: ${TASK_NOTEPAD_FRAGMENT}
**Task ID**: ${todo.id}
**Priority**: ${priority}
**Status**: ${todo.status}
**Started**: ${new Date().toISOString()}

## Findings

(Record what you learn about this code as you work — patterns, conventions, gotchas, useful references.)

## Blockers

(Anything blocking progress. Be specific: file path, line, error, workaround if any.)

## Questions

(Open questions to revisit later. Don't lose them when context compacts.)

## Results

(Summary on completion. What changed, what was verified, what remains.)
`
}
