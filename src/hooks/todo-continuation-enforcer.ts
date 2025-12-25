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
import { isNonInteractive } from "./non-interactive-env/detector"

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

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900 // Slightly less than 1s so toasts don't overlap

interface CountdownState {
  secondsRemaining: number
  intervalId: ReturnType<typeof setInterval>
}

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager } = options
  const remindedSessions = new Set<string>()
  const interruptedSessions = new Set<string>()
  const errorSessions = new Set<string>()
  const recoveringSessions = new Set<string>()
  const pendingCountdowns = new Map<string, CountdownState>()
  const preemptivelyInjectedSessions = new Set<string>()

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
        const isInterrupt = detectInterrupt(props?.error)
        errorSessions.add(sessionID)
        if (isInterrupt) {
          interruptedSessions.add(sessionID)
        }
        log(`[${HOOK_NAME}] session.error received`, { sessionID, isInterrupt, error: props?.error })
        
        const countdown = pendingCountdowns.get(sessionID)
        if (countdown) {
          clearInterval(countdown.intervalId)
          pendingCountdowns.delete(sessionID)
        }
      }
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle received`, { sessionID })

      const mainSessionID = getMainSessionID()
      if (mainSessionID && sessionID !== mainSessionID) {
        log(`[${HOOK_NAME}] Skipped: not main session`, { sessionID, mainSessionID })
        return
      }

      const existingCountdown = pendingCountdowns.get(sessionID)
      if (existingCountdown) {
        clearInterval(existingCountdown.intervalId)
        pendingCountdowns.delete(sessionID)
        log(`[${HOOK_NAME}] Cancelled existing countdown`, { sessionID })
      }

      // Check if session is in recovery mode - if so, skip entirely without clearing state
      if (recoveringSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: session in recovery mode`, { sessionID })
        return
      }

      const shouldBypass = interruptedSessions.has(sessionID) || errorSessions.has(sessionID)
      
      if (shouldBypass) {
        interruptedSessions.delete(sessionID)
        errorSessions.delete(sessionID)
        log(`[${HOOK_NAME}] Skipped: error/interrupt bypass`, { sessionID })
        return
      }

      if (remindedSessions.has(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: already reminded this session`, { sessionID })
        return
      }

      // Check for incomplete todos BEFORE starting countdown
      let todos: Todo[] = []
      try {
        log(`[${HOOK_NAME}] Fetching todos for session`, { sessionID })
        const response = await ctx.client.session.todo({
          path: { id: sessionID },
        })
        todos = (response.data ?? response) as Todo[]
        log(`[${HOOK_NAME}] Todo API response`, { sessionID, todosCount: todos?.length ?? 0 })
      } catch (err) {
        log(`[${HOOK_NAME}] Todo API error`, { sessionID, error: String(err) })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos found`, { sessionID })
        return
      }

      const incomplete = todos.filter(
        (t) => t.status !== "completed" && t.status !== "cancelled"
      )

      if (incomplete.length === 0) {
        log(`[${HOOK_NAME}] All todos completed`, { sessionID, total: todos.length })
        return
      }

      log(`[${HOOK_NAME}] Found incomplete todos, starting countdown`, { sessionID, incomplete: incomplete.length, total: todos.length })

      const showCountdownToast = async (seconds: number): Promise<void> => {
        await ctx.client.tui.showToast({
          body: {
            title: "Todo Continuation",
            message: `Resuming in ${seconds}s... (${incomplete.length} tasks remaining)`,
            variant: "warning" as const,
            duration: TOAST_DURATION_MS,
          },
        }).catch(() => {})
      }

      const executeAfterCountdown = async (): Promise<void> => {
        pendingCountdowns.delete(sessionID)
        log(`[${HOOK_NAME}] Countdown finished, executing continuation`, { sessionID })

        // Re-check conditions after countdown
        if (recoveringSessions.has(sessionID)) {
          log(`[${HOOK_NAME}] Abort: session entered recovery mode during countdown`, { sessionID })
          return
        }

        if (interruptedSessions.has(sessionID) || errorSessions.has(sessionID)) {
          log(`[${HOOK_NAME}] Abort: error/interrupt occurred during countdown`, { sessionID })
          interruptedSessions.delete(sessionID)
          errorSessions.delete(sessionID)
          return
        }

        let freshTodos: Todo[] = []
        try {
          log(`[${HOOK_NAME}] Re-verifying todos after countdown`, { sessionID })
          const response = await ctx.client.session.todo({
            path: { id: sessionID },
          })
          freshTodos = (response.data ?? response) as Todo[]
          log(`[${HOOK_NAME}] Fresh todo count`, { sessionID, todosCount: freshTodos?.length ?? 0 })
        } catch (err) {
          log(`[${HOOK_NAME}] Failed to re-verify todos`, { sessionID, error: String(err) })
          return
        }

        const freshIncomplete = freshTodos.filter(
          (t) => t.status !== "completed" && t.status !== "cancelled"
        )

        if (freshIncomplete.length === 0) {
          log(`[${HOOK_NAME}] Abort: no incomplete todos after countdown`, { sessionID, total: freshTodos.length })
          return
        }

        log(`[${HOOK_NAME}] Confirmed incomplete todos, proceeding with injection`, { sessionID, incomplete: freshIncomplete.length, total: freshTodos.length })

        remindedSessions.add(sessionID)

        try {
          // Get previous message's agent info to respect agent mode
          const messageDir = getMessageDir(sessionID)
          const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

          const agentHasWritePermission = !prevMessage?.tools || (prevMessage.tools.write !== false && prevMessage.tools.edit !== false)
          if (!agentHasWritePermission) {
            log(`[${HOOK_NAME}] Skipped: previous agent lacks write permission`, { sessionID, agent: prevMessage?.agent, tools: prevMessage?.tools })
            remindedSessions.delete(sessionID)
            return
          }

          log(`[${HOOK_NAME}] Injecting continuation prompt`, { sessionID, agent: prevMessage?.agent })
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: prevMessage?.agent,
              parts: [
                {
                  type: "text",
                  text: `${CONTINUATION_PROMPT}\n\n[Status: ${freshTodos.length - freshIncomplete.length}/${freshTodos.length} completed, ${freshIncomplete.length} remaining]`,
                },
              ],
            },
            query: { directory: ctx.directory },
          })
          log(`[${HOOK_NAME}] Continuation prompt injected successfully`, { sessionID })
        } catch (err) {
          log(`[${HOOK_NAME}] Prompt injection failed`, { sessionID, error: String(err) })
          remindedSessions.delete(sessionID)
        }
      }

      let secondsRemaining = COUNTDOWN_SECONDS
      showCountdownToast(secondsRemaining).catch(() => {})

      const intervalId = setInterval(() => {
        secondsRemaining--
        
        if (secondsRemaining <= 0) {
          clearInterval(intervalId)
          pendingCountdowns.delete(sessionID)
          executeAfterCountdown()
          return
        }

        const countdown = pendingCountdowns.get(sessionID)
        if (!countdown) {
          clearInterval(intervalId)
          return
        }

        countdown.secondsRemaining = secondsRemaining
        showCountdownToast(secondsRemaining).catch(() => {})
      }, 1000)

      pendingCountdowns.set(sessionID, { secondsRemaining, intervalId })
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined
      const finish = info?.finish as string | undefined
      log(`[${HOOK_NAME}] message.updated received`, { sessionID, role, finish })
      
      if (sessionID && role === "user") {
        const countdown = pendingCountdowns.get(sessionID)
        if (countdown) {
          clearInterval(countdown.intervalId)
          pendingCountdowns.delete(sessionID)
          log(`[${HOOK_NAME}] Cancelled countdown on user message`, { sessionID })
        }
        remindedSessions.delete(sessionID)
        preemptivelyInjectedSessions.delete(sessionID)
      }

      if (sessionID && role === "assistant" && finish) {
        remindedSessions.delete(sessionID)
        preemptivelyInjectedSessions.delete(sessionID)
        log(`[${HOOK_NAME}] Cleared reminded/preemptive state on assistant finish`, { sessionID })

        const isTerminalFinish = finish && !["tool-calls", "unknown"].includes(finish)
        if (isTerminalFinish && isNonInteractive()) {
          log(`[${HOOK_NAME}] Terminal finish in non-interactive mode`, { sessionID, finish })

          const mainSessionID = getMainSessionID()
          if (mainSessionID && sessionID !== mainSessionID) {
            log(`[${HOOK_NAME}] Skipped preemptive: not main session`, { sessionID, mainSessionID })
            return
          }

          if (preemptivelyInjectedSessions.has(sessionID)) {
            log(`[${HOOK_NAME}] Skipped preemptive: already injected`, { sessionID })
            return
          }

          if (recoveringSessions.has(sessionID) || errorSessions.has(sessionID) || interruptedSessions.has(sessionID)) {
            log(`[${HOOK_NAME}] Skipped preemptive: session in error/recovery state`, { sessionID })
            return
          }

          const hasRunningBgTasks = backgroundManager
            ? backgroundManager.getTasksByParentSession(sessionID).some((t) => t.status === "running")
            : false

          let hasIncompleteTodos = false
          try {
            const response = await ctx.client.session.todo({ path: { id: sessionID } })
            const todos = (response.data ?? response) as Todo[]
            hasIncompleteTodos = todos?.some((t) => t.status !== "completed" && t.status !== "cancelled") ?? false
          } catch {
            log(`[${HOOK_NAME}] Failed to fetch todos for preemptive check`, { sessionID })
          }

          if (hasRunningBgTasks || hasIncompleteTodos) {
            log(`[${HOOK_NAME}] Preemptive injection needed`, { sessionID, hasRunningBgTasks, hasIncompleteTodos })
            preemptivelyInjectedSessions.add(sessionID)

            try {
              const messageDir = getMessageDir(sessionID)
              const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

              const prompt = hasRunningBgTasks
                ? "[SYSTEM] Background tasks are still running. Wait for their completion before proceeding."
                : CONTINUATION_PROMPT

              await ctx.client.session.prompt({
                path: { id: sessionID },
                body: {
                  agent: prevMessage?.agent,
                  parts: [{ type: "text", text: prompt }],
                },
                query: { directory: ctx.directory },
              })
              log(`[${HOOK_NAME}] Preemptive injection successful`, { sessionID })
            } catch (err) {
              log(`[${HOOK_NAME}] Preemptive injection failed`, { sessionID, error: String(err) })
              preemptivelyInjectedSessions.delete(sessionID)
            }
          }
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
        preemptivelyInjectedSessions.delete(sessionInfo.id)
        
        const countdown = pendingCountdowns.get(sessionInfo.id)
        if (countdown) {
          clearInterval(countdown.intervalId)
          pendingCountdowns.delete(sessionInfo.id)
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
