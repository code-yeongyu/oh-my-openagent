import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"

interface TodoSnapshot {
  id: string
  content: string
  status: "pending" | "in_progress" | "completed" | "cancelled"
  priority?: "low" | "medium" | "high"
}

type TodoWriter = (input: { sessionID: string; todos: TodoSnapshot[] }) => Promise<void>

const HOOK_NAME = "compaction-todo-preserver"

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
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

export function createCompactionTodoPreserverHook(
  ctx: PluginInput,
): CompactionTodoPreserver {
  const snapshots = new Map<string, TodoSnapshot[]>()

  const capture = async (sessionID: string): Promise<void> => {
    if (!sessionID) return
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      const todos = extractTodos(response)
      if (todos.length === 0) return
      snapshots.set(sessionID, todos)
      log(`[${HOOK_NAME}] Captured todo snapshot`, { sessionID, count: todos.length })
    } catch (err) {
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

    if (hasCurrent && currentTodos.length > 0) {
      snapshots.delete(sessionID)
      log(`[${HOOK_NAME}] Skipped restore (todos already present)`, { sessionID, count: currentTodos.length })
      return
    }

    const writer = await resolveTodoWriter()
    if (!writer) {
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

  return { capture, event }
}
