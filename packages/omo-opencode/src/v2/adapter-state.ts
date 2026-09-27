import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"

export type TodoItem = {
  id?: string
  content: string
  status: string
  priority?: string
}

type ToastItem = {
  title?: string
  message: string
  variant?: string
}

export type AdapterState = {
  directory: string
  status: Map<string, { type: string }>
  sessions: Map<string, Record<string, unknown>>
  pendingManualContinue: Set<string>
  recordParent: (childID: string, parentID: string) => void
  parentOf: (childID: string) => string | undefined
  parents: () => Record<string, string>
  recordTodos: (sessionID: string, input: unknown) => void
  todos: (sessionID: string) => TodoItem[]
  recordToast: (input: { title?: string; message?: string; variant?: string; duration?: number }) => void
  readToasts: () => ToastItem[]
  noteStatus: (sessionID: string, type: string) => void
  noteSession: (session: Record<string, unknown>) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function readJson(file: string): unknown {
  if (!existsSync(file)) return undefined
  return JSON.parse(readFileSync(file, "utf8"))
}

function writeJson(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify(value))
}

function todoItems(input: unknown): TodoItem[] {
  const source = isRecord(input) && Array.isArray(input.todos) ? input.todos : Array.isArray(input) ? input : []
  const items: TodoItem[] = []
  for (const entry of source) {
    if (!isRecord(entry) || typeof entry.content !== "string") continue
    items.push({
      ...(typeof entry.id === "string" ? { id: entry.id } : {}),
      content: entry.content,
      status: typeof entry.status === "string" ? entry.status : "pending",
      ...(typeof entry.priority === "string" ? { priority: entry.priority } : {}),
    })
  }
  return items
}

export function createAdapterState(directory: string): AdapterState {
  const parentsFile = `${directory}/parents.json`
  const todosFile = `${directory}/todos.json`
  const toastsFile = `${directory}/toasts.json`
  const status = new Map<string, { type: string }>()
  const sessions = new Map<string, Record<string, unknown>>()
  const pendingManualContinue = new Set<string>()

  function parents(): Record<string, string> {
    const parsed = readJson(parentsFile)
    if (!isRecord(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
  }

  function todosBySession(): Record<string, TodoItem[]> {
    const parsed = readJson(todosFile)
    if (!isRecord(parsed)) return {}
    const result: Record<string, TodoItem[]> = {}
    for (const [sessionID, value] of Object.entries(parsed)) result[sessionID] = todoItems(value)
    return result
  }

  return {
    directory,
    status,
    sessions,
    pendingManualContinue,
    recordParent(childID, parentID) {
      writeJson(parentsFile, { ...parents(), [childID]: parentID })
    },
    parentOf(childID) {
      return parents()[childID]
    },
    parents,
    recordTodos(sessionID, input) {
      writeJson(todosFile, { ...todosBySession(), [sessionID]: todoItems(input) })
    },
    todos(sessionID) {
      return todosBySession()[sessionID] ?? []
    },
    recordToast(input) {
      if (typeof input.duration === "number" && input.duration < 200) return
      if (typeof input.message !== "string" || input.message.length === 0) return
      const current = this.readToasts()
      const last = current.at(-1)
      if (last && last.title === input.title && last.message === input.message) return
      current.push({
        ...(input.title ? { title: input.title } : {}),
        message: input.message,
        ...(input.variant ? { variant: input.variant } : {}),
      })
      writeJson(toastsFile, current)
    },
    readToasts() {
      const parsed = readJson(toastsFile)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isRecord).flatMap((entry) => {
        if (typeof entry.message !== "string") return []
        return [{
          ...(typeof entry.title === "string" ? { title: entry.title } : {}),
          message: entry.message,
          ...(typeof entry.variant === "string" ? { variant: entry.variant } : {}),
        }]
      })
    },
    noteStatus(sessionID, type) {
      status.set(sessionID, { type })
    },
    noteSession(session) {
      if (typeof session.id === "string") sessions.set(session.id, session)
    },
  }
}
