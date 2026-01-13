import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import type { BackgroundManager } from "../features/background-agent"
import { getMainSessionID, subagentSessions } from "../features/claude-code-session-state"
import {
    findNearestMessageWithFields,
    MESSAGE_STORAGE,
} from "../features/hook-message-injector"
import { log } from "../shared/logger"

const HOOK_NAME = "todo-continuation-enforcer"

const DEFAULT_SKIP_AGENTS = ["Prometheus (Planner)"]

export interface TodoContinuationEnforcerOptions {
  backgroundManager?: BackgroundManager
  skipAgents?: string[]
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
  countdownTimer?: ReturnType<typeof setTimeout>
  countdownInterval?: ReturnType<typeof setInterval>
  isRecovering?: boolean
  countdownStartedAt?: number
  abortDetectedAt?: number
}

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900
const COUNTDOWN_GRACE_PERIOD_MS = 500

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

function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(t => t.status !== "completed" && t.status !== "cancelled").length
}

interface MessageInfo {
  id?: string
  role?: string
  error?: { name?: string; data?: unknown }
}

function isLastAssistantMessageAborted(messages: Array<{ info?: MessageInfo }>): boolean {
  if (!messages || messages.length === 0) return false

  const assistantMessages = messages.filter(m => m.info?.role === "assistant")
  if (assistantMessages.length === 0) return false

  const lastAssistant = assistantMessages[assistantMessages.length - 1]
  const errorName = lastAssistant.info?.error?.name

  if (!errorName) return false

  return errorName === "MessageAbortedError" || errorName === "AbortError"
}

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager, skipAgents = DEFAULT_SKIP_AGENTS } = options
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
    state.countdownStartedAt = undefined
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

    const agentName = prevMessage?.agent
    if (agentName && skipAgents.includes(agentName)) {
      log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
      return
    }

    const editPermission = prevMessage?.tools?.edit
    const writePermission = prevMessage?.tools?.write
    const hasWritePermission = !prevMessage?.tools ||
      ((editPermission !== false && editPermission !== "deny") &&
       (writePermission !== false && writePermission !== "deny"))
    if (!hasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, { sessionID, agent: prevMessage?.agent })
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${todos.length - freshIncompleteCount}/${todos.length} completed, ${freshIncompleteCount} remaining]`

    try {
      log(`[${HOOK_NAME}] Injecting continuation`, { sessionID, agent: prevMessage?.agent, incompleteCount: freshIncompleteCount })

      // Don't pass model - let OpenCode use session's existing lastModel
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
    state.countdownStartedAt = Date.now()

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

      const error = props?.error as { name?: string } | undefined
      if (error?.name === "MessageAbortedError" || error?.name === "AbortError") {
        const state = getState(sessionID)
        state.abortDetectedAt = Date.now()
        log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName: error.name })
      }

      cancelCountdown(sessionID)
      log(`[${HOOK_NAME}] session.error`, { sessionID })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle`, { sessionID })

      const mainSessionID = getMainSessionID()
      const isMainSession = sessionID === mainSessionID
      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      if (mainSessionID && !isMainSession && !isBackgroundTaskSession) {
        log(`[${HOOK_NAME}] Skipped: not main or background task session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      // Check 1: Event-based abort detection (primary, most reliable)
      if (state.abortDetectedAt) {
        const timeSinceAbort = Date.now() - state.abortDetectedAt
        const ABORT_WINDOW_MS = 3000
        if (timeSinceAbort < ABORT_WINDOW_MS) {
          log(`[${HOOK_NAME}] Skipped: abort detected via event ${timeSinceAbort}ms ago`, { sessionID })
          state.abortDetectedAt = undefined
          return
        }
        state.abortDetectedAt = undefined
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks running`, { sessionID })
        return
      }

      // Check 2: API-based abort detection (fallback, for cases where event was missed)
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        })
        const messages = (messagesResp as { data?: Array<{ info?: MessageInfo }> }).data ?? []

        if (isLastAssistantMessageAborted(messages)) {
          log(`[${HOOK_NAME}] Skipped: last assistant message was aborted (API fallback)`, { sessionID })
          return
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Messages fetch failed, continuing`, { sessionID, error: String(err) })
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

      let agentName: string | undefined
      try {
        const messagesResp = await ctx.client.session.messages({
          path: { id: sessionID },
        })
        const messages = (messagesResp.data ?? []) as Array<{ info?: { agent?: string } }>
        for (let i = messages.length - 1; i >= 0; i--) {
          if (messages[i].info?.agent) {
            agentName = messages[i].info?.agent
            break
          }
        }
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to fetch messages for agent check`, { sessionID, error: String(err) })
      }

      log(`[${HOOK_NAME}] Agent check`, { sessionID, agentName, skipAgents })
      if (agentName && skipAgents.includes(agentName)) {
        log(`[${HOOK_NAME}] Skipped: agent in skipAgents list`, { sessionID, agent: agentName })
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
        if (state?.countdownStartedAt) {
          const elapsed = Date.now() - state.countdownStartedAt
          if (elapsed < COUNTDOWN_GRACE_PERIOD_MS) {
            log(`[${HOOK_NAME}] Ignoring user message in grace period`, { sessionID, elapsed })
            return
          }
        }
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }

      if (role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
        cancelCountdown(sessionID)
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = sessions.get(sessionID)
        if (state) state.abortDetectedAt = undefined
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
