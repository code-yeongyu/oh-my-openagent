import type { PluginInput } from "@opencode-ai/plugin"

interface Todo {
  content: string
  status: string
  priority: string
  id: string
}

type SessionStatus = "idle" | "aborted" | "continuation-sent"

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const CONTINUATION_DELAY_MS = 500

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
  const sessionStates = new Map<string, SessionStatus>()
  const pendingContinuations = new Map<string, Timer>()

  const cleanupSession = (sessionID: string) => {
    const timer = pendingContinuations.get(sessionID)
    if (timer) clearTimeout(timer)
    pendingContinuations.delete(sessionID)
    sessionStates.delete(sessionID)
  }

  const cancelPendingContinuation = (sessionID: string) => {
    const timer = pendingContinuations.get(sessionID)
    if (timer) {
      clearTimeout(timer)
      pendingContinuations.delete(sessionID)
    }
    sessionStates.set(sessionID, "aborted")
  }

  const scheduleContinuation = (sessionID: string) => {
    const prev = pendingContinuations.get(sessionID)
    if (prev) clearTimeout(prev)

    sessionStates.set(sessionID, "idle")

    const timer = setTimeout(async () => {
      pendingContinuations.delete(sessionID)

      const state = sessionStates.get(sessionID)
      if (state !== "idle") return

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

      sessionStates.set(sessionID, "continuation-sent")

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
        sessionStates.delete(sessionID)
      }
    }, CONTINUATION_DELAY_MS)

    pendingContinuations.set(sessionID, timer)
  }

  return async ({ event }: { event: { type: string; properties?: unknown } }) => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID && detectInterrupt(props?.error)) {
        cancelPendingContinuation(sessionID)
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const state = sessionStates.get(sessionID)
      if (state === "continuation-sent") return

      scheduleContinuation(sessionID)
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID && info?.role === "user") {
        sessionStates.delete(sessionID)
      }
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanupSession(sessionInfo.id)
      }
    }
  }
}
