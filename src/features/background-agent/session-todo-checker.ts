import type { OpencodeClient, Todo } from "./constants"

function isTodo(value: unknown): value is Todo {
  if (typeof value !== "object" || value === null) return false
  const todo = value as Record<string, unknown>
  return (
    typeof todo["id"] === "string" &&
    typeof todo["content"] === "string" &&
    typeof todo["status"] === "string" &&
    typeof todo["priority"] === "string"
  )
}

export async function checkSessionTodos(
  client: OpencodeClient,
  sessionID: string
): Promise<boolean> {
  try {
    const response = await client.session.todo({
      path: { id: sessionID },
    })

    const todosRaw = "data" in response ? response.data : response
    if (!Array.isArray(todosRaw) || todosRaw.length === 0) return false

    const incomplete = todosRaw
      .filter(isTodo)
      .filter((todo) => todo.status !== "completed" && todo.status !== "cancelled")
    return incomplete.length > 0
  } catch {
    return false
  }
}
