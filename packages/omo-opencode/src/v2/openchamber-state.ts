export type OpenChamberHost = {
  toast: (input: { kind: "info" | "success" | "error"; message: string }) => void
  listSessions: () => Promise<Array<{ id: string; title?: string }>>
  section?: (input: { title: string; body: string }) => void
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function kindFor(variant: unknown): "info" | "success" | "error" {
  if (variant === "success" || variant === "error") return variant
  return "info"
}

export function workStatusRows(todos: unknown): string[] {
  if (!isRecord(todos)) return []
  const rows: string[] = []
  for (const [sessionID, value] of Object.entries(todos)) {
    if (!Array.isArray(value)) continue
    for (const todo of value) {
      if (!isRecord(todo) || typeof todo.content !== "string") continue
      if (todo.status === "completed" || todo.status === "cancelled") continue
      rows.push(`${sessionID}: ${todo.content} (${typeof todo.status === "string" ? todo.status : "pending"})`)
    }
  }
  return rows
}

export async function publishOpenChamberState(input: {
  host: OpenChamberHost
  readFile: (path: string) => Promise<string>
}): Promise<{ toasts: number; rows: string[]; sessions: Array<{ id: string; title?: string }> }> {
  const toastFile = await input.readFile(".omo/v2-state/toasts.json").catch(() => "[]")
  const todoFile = await input.readFile(".omo/v2-state/todos.json").catch(() => "{}")
  const toasts = JSON.parse(toastFile)
  let count = 0
  if (Array.isArray(toasts)) {
    for (const toast of toasts) {
      if (!isRecord(toast) || typeof toast.message !== "string") continue
      const title = typeof toast.title === "string" ? `${toast.title}: ` : ""
      input.host.toast({ kind: kindFor(toast.variant), message: `${title}${toast.message}` })
      count += 1
    }
  }
  const rows = workStatusRows(JSON.parse(todoFile))
  input.host.section?.({ title: "Work Status", body: rows.join("\n") })
  const sessions = await input.host.listSessions()
  return { toasts: count, rows, sessions }
}
