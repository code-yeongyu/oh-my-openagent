import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

interface TodoSnapshot {
  id?: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

type TodoWriter = (input: { sessionID: string; todos: TodoSnapshot[] }) => Promise<void>
type ToolExecuteBeforeInput = { tool: string; sessionID: string; callID: string }
type ToolExecuteBeforeOutput = { args: Record<string, unknown> }

const HOOK_NAME = "compaction-todo-preserver"
const ATLAS_BOOTSTRAP_TODOS = [
  {
    id: "orchestrate-plan",
    content: "Complete ALL implementation tasks",
  },
  {
    id: "pass-final-wave",
    content: "Pass Final Verification Wave - ALL reviewers APPROVE",
  },
] as const

function extractTodos(response: unknown): TodoSnapshot[] {
  const payload = response as { data?: unknown }
  if (Array.isArray(payload?.data)) {
    return payload.data as TodoSnapshot[]
  }
  if (Array.isArray(response)) {
    return response as TodoSnapshot[]
  }
  return []
}

function isAtlasBootstrapTodo(todo: TodoSnapshot): boolean {
  return ATLAS_BOOTSTRAP_TODOS.some((bootstrapTodo) =>
    todo.id === bootstrapTodo.id || todo.content === bootstrapTodo.content
  )
}

function hasDetailedTodos(todos: TodoSnapshot[]): boolean {
  return todos.some((todo) => !isAtlasBootstrapTodo(todo))
}

function isAtlasBootstrapTodoList(todos: TodoSnapshot[]): boolean {
  return todos.length > 0 && todos.every(isAtlasBootstrapTodo)
}

function shouldRestoreOverCurrentTodos(input: {
  snapshot: TodoSnapshot[]
  currentTodos: TodoSnapshot[]
}): boolean {
  if (input.currentTodos.length === 0) return true
  if (!isAtlasBootstrapTodoList(input.currentTodos)) return false
  return hasDetailedTodos(input.snapshot)
}

function extractTodoArgument(value: unknown): TodoSnapshot[] {
  if (Array.isArray(value)) {
    return value as TodoSnapshot[]
  }

  if (typeof value !== "string") {
    return []
  }

  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed as TodoSnapshot[] : []
  } catch (err) {
    log(`[${HOOK_NAME}] Failed to parse todowrite todos`, { error: String(err) })
    return []
  }
}

function isTodoWriteTool(toolName: string): boolean {
  return toolName.trim().toLowerCase() === "todowrite"
}

async function resolveTodoWriter(): Promise<TodoWriter | null> {
  try {
    const loader = "opencode/session/todo"
    const mod = (await import(loader)) as {
      Todo?: { update?: TodoWriter }
    }
    const update = mod.Todo?.update
    if (typeof update === "function") {
      return update
    }
  } catch (err) {
    log(`[${HOOK_NAME}] Failed to resolve Todo.update`, { error: String(err) })
  }
  return null
}

function resolveSessionID(props?: Record<string, unknown>): string | undefined {
  return (props?.sessionID ??
    (props?.info as { id?: string } | undefined)?.id) as string | undefined
}

export interface CompactionTodoPreserver {
  capture: (sessionID: string) => Promise<void>
  restore: (sessionID: string) => Promise<void>
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "tool.execute.before": (input: ToolExecuteBeforeInput, output: ToolExecuteBeforeOutput) => Promise<void>
}

export function createCompactionTodoPreserverHook(
  ctx: PluginInput,
): CompactionTodoPreserver {
  const snapshots = new Map<string, TodoSnapshot[]>()
  const protectedSnapshots = new Map<string, TodoSnapshot[]>()

  const capture = async (sessionID: string): Promise<void> => {
    if (!sessionID) return
    protectedSnapshots.delete(sessionID)
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      const todos = extractTodos(response)
      if (todos.length === 0) {
        snapshots.delete(sessionID)
        return
      }
      if (!hasDetailedTodos(todos)) {
        snapshots.delete(sessionID)
        return
      }
      snapshots.set(sessionID, todos)
      log(`[${HOOK_NAME}] Captured todo snapshot`, { sessionID, count: todos.length })
    } catch (err) {
      snapshots.delete(sessionID)
      log(`[${HOOK_NAME}] Failed to capture todos`, { sessionID, error: String(err) })
    }
  }

  const restore = async (sessionID: string): Promise<void> => {
    const snapshot = snapshots.get(sessionID)
    if (!snapshot || snapshot.length === 0) return

    let hasCurrent = false
    let currentTodos: TodoSnapshot[] = []
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      currentTodos = extractTodos(response)
      hasCurrent = true
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos post-compaction`, { sessionID, error: String(err) })
    }

    if (hasCurrent && !shouldRestoreOverCurrentTodos({ snapshot, currentTodos })) {
      snapshots.delete(sessionID)
      if (hasDetailedTodos(currentTodos)) {
        protectedSnapshots.set(sessionID, currentTodos)
      } else {
        protectedSnapshots.delete(sessionID)
      }
      log(`[${HOOK_NAME}] Skipped restore (todos already present)`, { sessionID, count: currentTodos.length })
      return
    }

    protectedSnapshots.set(sessionID, snapshot)

    const writer = await resolveTodoWriter()
    if (!writer) {
      snapshots.delete(sessionID)
      log(`[${HOOK_NAME}] Skipped restore (Todo.update unavailable)`, { sessionID })
      return
    }

    try {
      await writer({ sessionID, todos: snapshot })
      log(`[${HOOK_NAME}] Restored todos after compaction`, { sessionID, count: snapshot.length })
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to restore todos`, { sessionID, error: String(err) })
    } finally {
      snapshots.delete(sessionID)
    }
  }

  const event = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.deleted") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        snapshots.delete(sessionID)
        protectedSnapshots.delete(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        snapshots.delete(sessionID)
        protectedSnapshots.delete(sessionID)
      }
      return
    }

    if (event.type === "session.compacted") {
      const sessionID = resolveSessionID(props)
      if (sessionID) {
        await restore(sessionID)
      }
      return
    }
  }

  const beforeToolExecute = async (
    input: ToolExecuteBeforeInput,
    output: ToolExecuteBeforeOutput,
  ): Promise<void> => {
    if (!isTodoWriteTool(input.tool)) {
      return
    }

    const snapshot = protectedSnapshots.get(input.sessionID)
    if (!snapshot || !hasDetailedTodos(snapshot)) {
      return
    }

    const requestedTodos = extractTodoArgument(output.args.todos)
    if (requestedTodos.length === 0) {
      return
    }

    if (!isAtlasBootstrapTodoList(requestedTodos)) {
      protectedSnapshots.delete(input.sessionID)
      return
    }

    output.args.todos = snapshot
    log(`[${HOOK_NAME}] Replaced late Atlas bootstrap todowrite with restored snapshot`, {
      sessionID: input.sessionID,
      count: snapshot.length,
    })
  }

  return { capture, restore, event, "tool.execute.before": beforeToolExecute }
}
