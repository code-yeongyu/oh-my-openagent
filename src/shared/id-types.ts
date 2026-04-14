export type IdType = "background" | "task" | "session" | "unknown"

export function detectIdType(id: string): IdType {
  if (id.startsWith("bg_")) return "background"
  if (id.startsWith("T-")) return "task"
  if (id.startsWith("ses_") || id.startsWith("ses-")) return "session"
  return "unknown"
}

export function formatIdTypeError(id: string, toolName: string): string {
  const type = detectIdType(id)
  switch (type) {
    case "session":
      return `This is a session id (${id}), not a background task id. Use session_read(session_id="${id}") to retrieve session messages.`
    case "task":
      return `This is a plan task id (${id}), not a background task id. Plan task ids (T-...) are used by task_update/task_get, not ${toolName}. Background task ids start with bg_.`
    case "background":
      return `Task not found: ${id}`
    default:
      return `Task not found: ${id}`
  }
}
