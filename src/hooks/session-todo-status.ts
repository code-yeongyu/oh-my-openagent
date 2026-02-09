import type { PluginInput } from "@opencode-ai/plugin"

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export async function hasIncompleteTodos(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    const todos = (response.data ?? response) as Todo[]
    if (!todos || todos.length === 0) return false
    return todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled")
  } catch {
    return false
  }
}
