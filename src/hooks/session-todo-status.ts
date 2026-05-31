import type { PluginInput } from "@opencode-ai/plugin"
import { readContinuationMarker } from "../features/run-continuation-state"
import { normalizeSDKResponse } from "../shared"

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

export async function hasIncompleteTodos(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    const response = await ctx.client.session.todo({ path: { id: sessionID } })
    const todos = normalizeSDKResponse(response, [] as Todo[], { preferResponseOnMissingData: true })
    if (!todos || todos.length === 0) return false
    return todos.some((todo) => todo.status !== "completed" && todo.status !== "cancelled")
  } catch {
    return false
  }
}

export async function hasPendingSessionWork(ctx: PluginInput, sessionID: string): Promise<boolean> {
  const marker = readContinuationMarker(ctx.directory, sessionID)
  if (marker?.sources["background-task"]?.state === "active") {
    return true
  }

  return hasIncompleteTodos(ctx, sessionID)
}
