import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import {
  findNearestMessageWithFields,
  MESSAGE_STORAGE,
} from "../features/hook-message-injector"

export interface TodoContinuationEnforcer {
  handler: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  markRecovering: (sessionID: string) => void
  markRecoveryComplete: (sessionID: string) => void
}

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

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

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

export function createTodoContinuationEnforcer(ctx: PluginInput): TodoContinuationEnforcer {
  const remindedSessions = new Set<string>()
  const interruptedSessions = new Set<string>()
  const errorSessions = new Set<string>()
  const recoveringSessions = new Set<string>()
  const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>()

  const markRecovering = (sessionID: string): void => {
    recoveringSessions.add(sessionID)
  }

  const markRecoveryComplete = (sessionID: string): void => {
    recoveringSessions.delete(sessionID)
  }

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        errorSessions.add(sessionID)
        if (detectInterrupt(props?.error)) {
          interruptedSessions.add(sessionID)
        }
        
        // Cancel pending continuation if error occurs
        const timer = pendingTimers.get(sessionID)
        if (timer) {
          clearTimeout(timer)
          pendingTimers.delete(sessionID)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      // Cancel any existing timer to debounce
      const existingTimer = pendingTimers.get(sessionID)
      if (existingTimer) {
        clearTimeout(existingTimer)
      }

      // Schedule continuation check
      const timer = setTimeout(async () => {
        pendingTimers.delete(sessionID)

        // Check if session is in recovery mode - if so, skip entirely without clearing state
        if (recoveringSessions.has(sessionID)) {
          return
        }

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

        // Re-check if abort occurred during the delay/fetch
        if (interruptedSessions.has(sessionID) || errorSessions.has(sessionID) || recoveringSessions.has(sessionID)) {
          remindedSessions.delete(sessionID)
          return
        }

        try {
          // Get previous message's agent info to respect agent mode
          const messageDir = getMessageDir(sessionID)
          const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: prevMessage?.agent,
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
      }, 200)

      pendingTimers.set(sessionID, timer)
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      if (sessionID && info?.role === "user") {
        remindedSessions.delete(sessionID)
        
        // Cancel pending continuation on user interaction
        const timer = pendingTimers.get(sessionID)
        if (timer) {
          clearTimeout(timer)
          pendingTimers.delete(sessionID)
        }
      }
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        remindedSessions.delete(sessionInfo.id)
        interruptedSessions.delete(sessionInfo.id)
        errorSessions.delete(sessionInfo.id)
        recoveringSessions.delete(sessionInfo.id)
        
        // Cancel pending continuation
        const timer = pendingTimers.get(sessionInfo.id)
        if (timer) {
          clearTimeout(timer)
          pendingTimers.delete(sessionInfo.id)
        }
      }
    }
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
  }
}
