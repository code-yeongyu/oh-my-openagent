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

const CONTINUATION_PROMPT = `[SYSTEM REMINDER - TODO CONTINUATION]

Incomplete tasks remain in your todo list. Continue working on the next pending task.

- Proceed without asking for permission
- Mark each task complete when finished
- Do not stop until all tasks are done`

const COUNTDOWN_SECONDS = 2
const TOAST_DURATION_MS = 900
const MIN_INJECTION_INTERVAL_MS = 10_000

// ============================================================================
// STATE MACHINE TYPES
// ============================================================================

type SessionMode =
  | "idle"           // Observed idle, no countdown started yet
  | "countingDown"   // Waiting N seconds before injecting
  | "injecting"      // Currently calling session.prompt
  | "recovering"     // Session recovery in progress (external control)
  | "errorBypass"    // Bypass mode after session.error/interrupt

interface SessionState {
  version: number                          // Monotonic generation token - increment to invalidate pending callbacks
  mode: SessionMode
  timer?: ReturnType<typeof setTimeout>    // Pending countdown timer
  lastAttemptedAt?: number                 // Timestamp of last injection attempt (throttle all attempts)
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

function getIncompleteCount(todos: Todo[]): number {
  return todos.filter(t => t.status !== "completed" && t.status !== "cancelled").length
}

// ============================================================================
// MAIN IMPLEMENTATION
// ============================================================================

export function createTodoContinuationEnforcer(
  ctx: PluginInput,
  options: TodoContinuationEnforcerOptions = {}
): TodoContinuationEnforcer {
  const { backgroundManager } = options
  
  // Single source of truth: per-session state machine
  const sessions = new Map<string, SessionState>()

  // ============================================================================
  // STATE HELPERS
  // ============================================================================

  function getOrCreateState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = { version: 0, mode: "idle" }
      sessions.set(sessionID, state)
    }
    return state
  }

  function clearTimer(state: SessionState): void {
    if (state.timer) {
      clearTimeout(state.timer)
      state.timer = undefined
    }
  }

  /**
   * Invalidate any pending or in-flight operation by incrementing version.
   * ALWAYS bumps version regardless of current mode to prevent last-mile races.
   */
  function invalidate(sessionID: string, reason: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    // Skip if in recovery mode (external control)
    if (state.mode === "recovering") return

    state.version++
    clearTimer(state)
    
    if (state.mode !== "idle" && state.mode !== "errorBypass") {
      log(`[${HOOK_NAME}] Invalidated`, { sessionID, reason, prevMode: state.mode, newVersion: state.version })
      state.mode = "idle"
    }
  }

  /**
   * Check if this is the main session (not a subagent session).
   */
  function isMainSession(sessionID: string): boolean {
    const mainSessionID = getMainSessionID()
    // If no main session is set, allow all. If set, only allow main.
    return !mainSessionID || sessionID === mainSessionID
  }

  // ============================================================================
  // EXTERNAL API
  // ============================================================================

  const markRecovering = (sessionID: string): void => {
    const state = getOrCreateState(sessionID)
    invalidate(sessionID, "entering recovery mode")
    state.mode = "recovering"
    log(`[${HOOK_NAME}] Session marked as recovering`, { sessionID })
  }

  const markRecoveryComplete = (sessionID: string): void => {
    const state = sessions.get(sessionID)
    if (state && state.mode === "recovering") {
      state.mode = "idle"
      log(`[${HOOK_NAME}] Session recovery complete`, { sessionID })
    }
  }

  // ============================================================================
  // TOAST HELPER
  // ============================================================================

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

  // ============================================================================
  // CORE INJECTION LOGIC
  // ============================================================================

  async function executeInjection(sessionID: string, capturedVersion: number): Promise<void> {
    const state = sessions.get(sessionID)
    if (!state) return

    // Version check: if version changed since we started, abort
    if (state.version !== capturedVersion) {
      log(`[${HOOK_NAME}] Injection aborted: version mismatch`, { 
        sessionID, capturedVersion, currentVersion: state.version 
      })
      return
    }

    // Mode check: must still be in countingDown mode
    if (state.mode !== "countingDown") {
      log(`[${HOOK_NAME}] Injection aborted: mode changed`, { 
        sessionID, mode: state.mode 
      })
      return
    }

    // Throttle check: minimum interval between injection attempts
    if (state.lastAttemptedAt) {
      const elapsed = Date.now() - state.lastAttemptedAt
      if (elapsed < MIN_INJECTION_INTERVAL_MS) {
        log(`[${HOOK_NAME}] Injection throttled: too soon since last injection`, { 
          sessionID, elapsedMs: elapsed, minIntervalMs: MIN_INJECTION_INTERVAL_MS 
        })
        state.mode = "idle"
        return
      }
    }

    state.mode = "injecting"

    // Re-verify todos (CRITICAL: always re-check before injecting)
    let todos: Todo[] = []
    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      todos = (response.data ?? response) as Todo[]
    } catch (err) {
      log(`[${HOOK_NAME}] Failed to fetch todos for injection`, { sessionID, error: String(err) })
      state.mode = "idle"
      return
    }

    // Version check again after async operation
    if (state.version !== capturedVersion) {
      log(`[${HOOK_NAME}] Injection aborted after todo fetch: version mismatch`, { sessionID })
      state.mode = "idle"
      return
    }

    const incompleteCount = getIncompleteCount(todos)
    if (incompleteCount === 0) {
      log(`[${HOOK_NAME}] No incomplete todos at injection time`, { sessionID, total: todos.length })
      state.mode = "idle"
      return
    }

    // Skip entirely if background tasks are running (no false positives)
    const hasRunningBgTasks = backgroundManager
      ? backgroundManager.getTasksByParentSession(sessionID).some((t) => t.status === "running")
      : false

    if (hasRunningBgTasks) {
      log(`[${HOOK_NAME}] Skipped: background tasks still running`, { sessionID })
      state.mode = "idle"
      return
    }

    // Get previous message agent info
    const messageDir = getMessageDir(sessionID)
    const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null

    // Check write permission
    const agentHasWritePermission = !prevMessage?.tools || 
      (prevMessage.tools.write !== false && prevMessage.tools.edit !== false)
    
    if (!agentHasWritePermission) {
      log(`[${HOOK_NAME}] Skipped: agent lacks write permission`, {
        sessionID, agent: prevMessage?.agent, tools: prevMessage?.tools
      })
      state.mode = "idle"
      return
    }

    // Plan mode agents only analyze and plan, not implement - skip todo continuation
    const agentName = prevMessage?.agent?.toLowerCase() ?? ""
    const isPlanModeAgent = agentName === "plan" || agentName === "planner-sisyphus"
    if (isPlanModeAgent) {
      log(`[${HOOK_NAME}] Skipped: plan mode agent detected`, {
        sessionID, agent: prevMessage?.agent
      })
      state.mode = "idle"
      return
    }

    const prompt = `${CONTINUATION_PROMPT}\n\n[Status: ${todos.length - incompleteCount}/${todos.length} completed, ${incompleteCount} remaining]`

    // Final version check right before API call (last-mile race mitigation)
    if (state.version !== capturedVersion) {
      log(`[${HOOK_NAME}] Injection aborted: version changed before API call`, { sessionID })
      state.mode = "idle"
      return
    }

    // Set lastAttemptedAt BEFORE calling API (throttle attempts, not just successes)
    state.lastAttemptedAt = Date.now()

    try {
      log(`[${HOOK_NAME}] Injecting continuation prompt`, { 
        sessionID, 
        agent: prevMessage?.agent,
        incompleteCount
      })

      await ctx.client.session.prompt({
        path: { id: sessionID },
        body: {
          agent: prevMessage?.agent,
          parts: [{ type: "text", text: prompt }],
        },
        query: { directory: ctx.directory },
      })

      log(`[${HOOK_NAME}] Continuation prompt injected successfully`, { sessionID })
    } catch (err) {
      log(`[${HOOK_NAME}] Prompt injection failed`, { sessionID, error: String(err) })
    }

    state.mode = "idle"
  }

  // ============================================================================
  // COUNTDOWN STARTER
  // ============================================================================

  function startCountdown(sessionID: string, incompleteCount: number): void {
    const state = getOrCreateState(sessionID)

    // Cancel any existing countdown
    invalidate(sessionID, "starting new countdown")

    // Increment version for this new countdown
    state.version++
    state.mode = "countingDown"
    const capturedVersion = state.version

    log(`[${HOOK_NAME}] Starting countdown`, { 
      sessionID, 
      seconds: COUNTDOWN_SECONDS, 
      version: capturedVersion,
      incompleteCount
    })

    // Show initial toast
    showCountdownToast(COUNTDOWN_SECONDS, incompleteCount)

    // Show countdown toasts
    let secondsRemaining = COUNTDOWN_SECONDS
    const toastInterval = setInterval(() => {
      // Check if countdown was cancelled
      if (state.version !== capturedVersion) {
        clearInterval(toastInterval)
        return
      }
      secondsRemaining--
      if (secondsRemaining > 0) {
        showCountdownToast(secondsRemaining, incompleteCount)
      }
    }, 1000)

    // Schedule the injection
    state.timer = setTimeout(() => {
      clearInterval(toastInterval)
      clearTimer(state)
      executeInjection(sessionID, capturedVersion)
    }, COUNTDOWN_SECONDS * 1000)
  }

  // ============================================================================
  // EVENT HANDLER
  // ============================================================================

  const handler = async ({ event }: { event: { type: string; properties?: unknown } }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    // -------------------------------------------------------------------------
    // SESSION.ERROR - Enter error bypass mode
    // -------------------------------------------------------------------------
    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const isInterrupt = detectInterrupt(props?.error)
      const state = getOrCreateState(sessionID)
      
      invalidate(sessionID, isInterrupt ? "user interrupt" : "session error")
      state.mode = "errorBypass"
      
      log(`[${HOOK_NAME}] session.error received`, { sessionID, isInterrupt, error: props?.error })
      return
    }

    // -------------------------------------------------------------------------
    // SESSION.IDLE - Main trigger for todo continuation
    // -------------------------------------------------------------------------
    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${HOOK_NAME}] session.idle received`, { sessionID })

      // Skip if not main session
      if (!isMainSession(sessionID)) {
        log(`[${HOOK_NAME}] Skipped: not main session`, { sessionID })
        return
      }

      const state = getOrCreateState(sessionID)

      // Skip if in recovery mode
      if (state.mode === "recovering") {
        log(`[${HOOK_NAME}] Skipped: session in recovery mode`, { sessionID })
        return
      }

      // Skip if in error bypass mode (clear it for next time)
      if (state.mode === "errorBypass") {
        state.mode = "idle"
        log(`[${HOOK_NAME}] Skipped: error bypass (cleared for next idle)`, { sessionID })
        return
      }

      // Skip if already counting down or injecting
      if (state.mode === "countingDown" || state.mode === "injecting") {
        log(`[${HOOK_NAME}] Skipped: already ${state.mode}`, { sessionID })
        return
      }

      // Fetch todos
      let todos: Todo[] = []
      try {
        const response = await ctx.client.session.todo({ path: { id: sessionID } })
        todos = (response.data ?? response) as Todo[]
      } catch (err) {
        log(`[${HOOK_NAME}] Todo API error`, { sessionID, error: String(err) })
        return
      }

      if (!todos || todos.length === 0) {
        log(`[${HOOK_NAME}] No todos found`, { sessionID })
        return
      }

      const incompleteCount = getIncompleteCount(todos)
      if (incompleteCount === 0) {
        log(`[${HOOK_NAME}] All todos completed`, { sessionID, total: todos.length })
        return
      }

      // Skip if background tasks are running (avoid toast spam with no injection)
      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some((t) => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks still running`, { sessionID })
        return
      }

      log(`[${HOOK_NAME}] Found incomplete todos`, { 
        sessionID, 
        incomplete: incompleteCount, 
        total: todos.length 
      })

      startCountdown(sessionID, incompleteCount)
      return
    }

    // -------------------------------------------------------------------------
    // MESSAGE.UPDATED - Cancel countdown on activity
    // -------------------------------------------------------------------------
    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined
      const finish = info?.finish as string | undefined

      if (!sessionID) return

      // User message: Always cancel countdown
      if (role === "user") {
        invalidate(sessionID, "user message received")
        return
      }

      // Assistant message WITHOUT finish: Agent is working, cancel countdown
      if (role === "assistant" && !finish) {
        invalidate(sessionID, "assistant is working (streaming)")
        return
      }

      // Assistant message WITH finish: Agent finished a turn (let session.idle handle it)
      if (role === "assistant" && finish) {
        log(`[${HOOK_NAME}] Assistant turn finished`, { sessionID, finish })
        return
      }
      return
    }

    // -------------------------------------------------------------------------
    // MESSAGE.PART.UPDATED - Cancel countdown on streaming activity
    // -------------------------------------------------------------------------
    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        invalidate(sessionID, "assistant streaming")
      }
      return
    }

    // -------------------------------------------------------------------------
    // TOOL EVENTS - Cancel countdown when tools are executing
    // -------------------------------------------------------------------------
    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        invalidate(sessionID, `tool execution (${event.type})`)
      }
      return
    }

    // -------------------------------------------------------------------------
    // SESSION.DELETED - Cleanup
    // -------------------------------------------------------------------------
    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        const state = sessions.get(sessionInfo.id)
        if (state) {
          clearTimer(state)
        }
        sessions.delete(sessionInfo.id)
        log(`[${HOOK_NAME}] Session deleted, state cleaned up`, { sessionID: sessionInfo.id })
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
