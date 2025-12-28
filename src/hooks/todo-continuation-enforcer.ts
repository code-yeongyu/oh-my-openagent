import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { getMainSessionID } from "../features/claude-code-session-state"
import {
  findNearestMessageWithFields,
  MESSAGE_STORAGE,
} from "../features/hook-message-injector"
import type { BackgroundManager } from "../features/background-agent"
import { log } from "../shared/logger"

const HOOK_NAME = "todo-continuation-enforcer"

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
}

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

interface SessionState {
  lastErrorAt?: number
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
}

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900
const ERROR_COOLDOWN_MS = 3_000

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

function isAbortError(error: unknown): boolean {
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

function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(t => t.status !== "completed" && t.status !== "cancelled").length
}

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager } = options
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return
    
    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }
    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  const markRecovering = (sessionID: string): void => {
    const state = getState(sessionID)
    state.isRecovering = true
    cancelCountdown(sessionID)
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state) {
      state.isRecovering = false
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
    }
  }

  async function showCountdownToast(seconds: number, incompleteCount: number): Promise<void> {
    await ctx.client.tui.showToast({
      body: {
        title: "Todo Continuation",
        message: `Resuming in ${seconds}s... (${incompleteCount} tasks remaining)`,
        variant: "warning" as const,
        duration: TOAST_DURATION_MS,
      },
    }).catch(() => {})
  }

  async function injectContinuation(sessionID: string, incompleteCount: number, total: number): Promise<void> {
    const state = sessions.get(sessionID)
    
    if (state?.isRecovering) {
      log(`[${HOOK_NAME}] Skipped injection: in recovery`, { sessionID })
      return
    }

    if (state?.lastErrorAt && Date.now() - state.lastErrorAt < ERROR_COOLDOWN_MS) {
      log(`[${HOOK_NAME}] Skipped injection: recent error`, { sessionID })
      return
    }

    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped injection: background tasks running`, { sessionID })
      return
    }

    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      todos = (response.data ?? response) as Todo[]
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos`, { sessionID, error: String(err) })
      return
    }

    const freshIncompleteCount = getIncompleteCount(todos)
    if (freshIncompleteCount === 0) {
      log(`[${HOOK_NAME}] Skipped injection: no incomplete todos`, { sessionID })
      return
    }

    const messageDir = getMessageDir(sessionID)
    const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

    const hasWritePermission = !prevMessage?.tools || 
      (prevMessage.tools.write !== false && prevMessage.tools.edit !== false)
    
    if (!hasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: prevMessage?.agent })
      return
    }

    const agentName = prevMessage?.agent?.toLowerCase() ?? ""
    if (agentName === "plan" || agentName === "planner-sisyphus") {
      log(`[${HOOK_NAME}] Skipped: plan mode agent`, { sessionID, agent: prevMessage?.agent })
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${todos.length - freshIncompleteCount}/${todos.length} completed, ${freshIncompleteCount} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, { sessionID, agent: prevMessage?.agent, incompleteCount: freshIncompleteCount })
      
      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: prevMessage?.agent,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })
      
      log(`[${HOOK_NAME}] Injection successful`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Injection failed`, { sessionID, error: String(err) })
    }
  }

  function startCountdown(sessionID: string, incompleteCount: number, total: number): void {
    const state = getState(sessionID)
    cancelCountdown(sessionID)

    let secondsRemaining = COUNTDOWN_SECONDS
    showCountdownToast(secondsRemaining, incompleteCount)

    state.countdownInterval = setInterval(() => {
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    state.countdownTimer = setTimeout(() => {
      cancelCountdown(sessionID)
      injectContinuation(sessionID, incompleteCount, total)
    }, COUNTDOWN_SECONDS * 1000)

    log(`[${HOOK_NAME}] Countdown started`, { sessionID, seconds: COUNTDOWN_SECONDS, incompleteCount })
  }

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const state = getState(sessionID)
      state.lastErrorAt = Date.now()
      cancelCountdown(sessionID)
      
      log(`[${HOOK_NAME}] session.error`, { sessionID, isAbort: isAbortError(props?.error) })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const mainSessionID = getMainSessionID()
      if (mainSessionID && sessionID !== mainSessionID) {
        log(`[${HOOK_NAME}] Skipped: not main session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      if (state.lastErrorAt && Date.now() - state.lastErrorAt < ERROR_COOLDOWN_MS) {
        log(`[${HOOK_NAME}] Skipped: recent error (cooldown)`, { sessionID })
        return
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({ path: { id: sessionID } })
        todos = (response.data ?? response) as Todo[]
      } catch (err) {
        log(`[${HOOK_NAME}] Todo fetch failed`, { sessionID, error: String(err) })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All todos complete`, { sessionID, total: todos.length })
        return
      }

      startCountdown(sessionID, incompleteCount, todos.length)
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (!sessionID) return

      if (role === "user") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastErrorAt = undefined
        }
        cancelCountdown(sessionID)
        log(`[${HOOK_NAME}] User message: cleared error state`, { sessionID })
      }

      if (role === "assistant") {
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        cleanup(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }
  }

  return {
    handler,
    markRecovering,
    markRecoveryComplete,
  }
}
