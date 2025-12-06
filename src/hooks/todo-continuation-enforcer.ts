import type { PluginInput } from "@opencode-ai/plugin"

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

function detectInterrupt(error: unknown): boolean {
  if (!error) return false
  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""
    if (name === "MessageAbortedError" || name === "AbortError") return true
    if (name === "DOMException" && message.includes("abort")) return true
    if (message.includes("aborted") || message.includes("cancelled") || message.includes("interrupted")) return true
  }
  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }
  return false
}

export function createTodoContinuationEnforcer(ctx: PluginInput) {
  const remindedSessions = new Set<string>()
  const interruptedSessions = new Set<string>()
  const errorSessions = new Set<string>()

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        errorSessions.add(sessionID)
        if (detectInterrupt(props?.error)) {
          interruptedSessions.add(sessionID)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      // Wait for potential session.error events to be processed first
      await new Promise(resolve => setTimeout(resolve, 150))

      const shouldBypass = interruptedSessions.has(sessionID) || errorSessions.has(sessionID)
      
      interruptedSessions.delete(sessionID)
      errorSessions.delete(sessionID)

      if (shouldBypass) {
        return
      }

      if (remindedSessions.has(sessionID)) {
        return
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({
          path: { id: sessionID },
        })
        todos = (response.data ?? response) as Todo[]
      } catch {
        return
      }

      if (!todos || todos.length === 0) {
        return
      }

      const incomplete = todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      )

      if (incomplete.length === 0) {
        return
      }

      remindedSessions.add(sessionID)

      // Re-check if abort occurred during the delay
      if (interruptedSessions.has(sessionID) || errorSessions.has(sessionID)) {
        remindedSessions.delete(sessionID)
        return
      }

      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [
              {
                type: "text",
                text: `${CONTINUATION_PROMPT}\n\n[Status: ${todos.length - incomplete.length}/${todos.length} completed, ${incomplete.length} remaining]`,
              },
            ],
          },
          query: { directory: ctx.directory },
        })
      } catch {
        remindedSessions.delete(sessionID)
      }
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID && info?.role === "user") {
        remindedSessions.delete(sessionID)
      }
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        remindedSessions.delete(sessionInfo.id)
        interruptedSessions.delete(sessionInfo.id)
        errorSessions.delete(sessionInfo.id)
      }
    }
  }
}
