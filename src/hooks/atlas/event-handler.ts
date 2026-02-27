import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { getPlanProgress, readBoulderState } from "../../features/boulder-state"
import { getMainSessionID, subagentSessions } from "../../features/claude-code-session-state"
import { log } from "../../shared/logger"
import { getCompactionCooldownRemaining, isInCompactionCooldown } from "../compaction-state"
import { ARCHIVER_DISPATCH_PROMPT } from "./system-reminder-templates"
import { detectBlockedResponse } from "./tool-execute-after"

export interface SessionState {
  lastEventWasAbortError?: boolean
  lastContinuationInjectedAt?: number
  lastToolExecutionAt?: number
}

export interface AtlasEvent {
  type: string
  properties?: unknown
}

interface CreateEventHandlerOptions {
  ctx: PluginInput
  hookName: string
  backgroundManager?: BackgroundManager
  sessions: Map<string, SessionState>
  getState: (sessionID: string) => SessionState
  getLastAgentFromSession: (sessionID: string) => string | null
  injectContinuation: (
    sessionID: string,
    planName: string,
    tasksPath: string,
    remaining: number,
    total: number,
    agent?: string
  ) => Promise<void>
}

const CONTINUATION_COOLDOWN_MS = 5000
const POST_TOOL_COOLDOWN_MS = 10000

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

function isCompactionCooldownActive(sessionID: string, hookName: string): boolean {
  if (!isInCompactionCooldown(sessionID)) {
    return false
  }

  log(`[${hookName}] Skipped: post-compact cooldown active`, {
    sessionID,
    cooldownRemaining: getCompactionCooldownRemaining(sessionID),
  })
  return true
}

async function handleCompactionAgentMessageUpdated(
  sessionID: string,
  agent: string | undefined,
  hookName: string
): Promise<boolean> {
  // Detect compaction agent - trigger cooldown to prevent boulder-reminder conflict
  if (agent !== "compaction") {
    return false
  }

  const { markCompaction } = await import("../compaction-state")
  markCompaction(sessionID)
  log(`[${hookName}] Compaction agent detected, starting 1-minute cooldown`, { sessionID })
  return true
}

export function createEventHandler(options: CreateEventHandlerOptions) {
  const {
    ctx,
    hookName,
    backgroundManager,
    sessions,
    getState,
    getLastAgentFromSession,
    injectContinuation,
  } = options

  return async ({ event }: { event: AtlasEvent }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const state = getState(sessionID)
      const isAbort = isAbortError(props?.error)
      state.lastEventWasAbortError = isAbort

      // Detect context limit errors which trigger compaction
      // Note: This is a fallback - the main compaction detection is via onSummarize hook
      // in compaction-context-injector which uses shared compaction-state
      const error = props?.error as Record<string, unknown> | undefined
      const errorStr = JSON.stringify(error ?? {}).toLowerCase()
      if (
        errorStr.includes("prompt is too long") ||
        errorStr.includes("context limit") ||
        errorStr.includes("server-side context limit") ||
        (errorStr.includes("token") && errorStr.includes("limit"))
      ) {
        log(`[${hookName}] Context limit error detected`, { sessionID, errorStr: errorStr.slice(0, 200) })
      }

      log(`[${hookName}] session.error`, { sessionID, isAbort })
      return
    }

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      log(`[${hookName}] session.idle`, { sessionID })

      // Read boulder state FIRST to check if this session is part of an active boulder
      const boulderState = readBoulderState(ctx.directory)
      const isBoulderSession = boulderState?.session_ids.includes(sessionID) ?? false

      const mainSessionID = getMainSessionID()
      const isMainSession = sessionID === mainSessionID
      const isBackgroundTaskSession = subagentSessions.has(sessionID)

      // Allow continuation if: main session OR background task OR boulder session
      if (mainSessionID && !isMainSession && !isBackgroundTaskSession && !isBoulderSession) {
        log(`[${hookName}] Skipped: not main, background task, or boulder session`, { sessionID })
        return
      }

      const state = getState(sessionID)

      if (state.lastEventWasAbortError) {
        state.lastEventWasAbortError = false
        log(`[${hookName}] Skipped: abort error immediately before idle`, { sessionID })
        return
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some((t) => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${hookName}] Skipped: background tasks running`, { sessionID })
        return
      }

      // Post-tool execution cooldown (prevents interrupting active work)
      if (state.lastToolExecutionAt) {
        const timeSinceToolExec = Date.now() - state.lastToolExecutionAt
        if (timeSinceToolExec < POST_TOOL_COOLDOWN_MS) {
          log(
            `[${hookName}] Skipped: post-tool cooldown active (${timeSinceToolExec}ms < ${POST_TOOL_COOLDOWN_MS}ms)`,
            { sessionID }
          )
          return
        }
      }

      // Post-compact cooldown (1 minute after compact, don't auto-continue)
      if (isCompactionCooldownActive(sessionID, hookName)) {
        return
      }

      if (!boulderState) {
        log(`[${hookName}] No active boulder`, { sessionID })
        return
      }

      // CRITICAL: Check if current session is in boulder's session_ids
      // This ensures Boulder continuation only triggers for sessions that started/joined the boulder
      if (!boulderState.session_ids.includes(sessionID)) {
        log(`[${hookName}] Skipped: session not in boulder session_ids`, {
          sessionID,
          plan: boulderState.plan_name,
          allowedSessions: boulderState.session_ids,
        })
        return
      }

      const requiredAgent = (boulderState.agent ?? "atlas").toLowerCase()
      const lastAgent = getLastAgentFromSession(sessionID)
      if (!lastAgent || lastAgent !== requiredAgent) {
        log(`[${hookName}] Skipped: last agent does not match boulder agent`, {
          sessionID,
          lastAgent: lastAgent ?? "unknown",
          requiredAgent,
        })
        return
      }

      // CRITICAL: Check if boulder is already completed OR awaiting user input to prevent repeated Phase 3 triggers
      if (boulderState.phase === "completed" || boulderState.phase === "awaiting_user" || boulderState.completed_at) {
        log(`[${hookName}] Boulder in terminal state (${boulderState.phase}), skipping Phase 3`, {
          sessionID,
          plan: boulderState.plan_name,
        })
        return
      }

      const progress = getPlanProgress(boulderState.active_plan)
      if (progress.isComplete) {
        log(`[${hookName}] Boulder complete - triggering Phase 3`, { sessionID, plan: boulderState.plan_name })

        // Set phase to awaiting_user FIRST to prevent repeated triggers
        // This blocks future session.idle events from re-injecting Phase 3
        const { updatePhaseStatus } = await import("../../features/boulder-state/storage")
        updatePhaseStatus(ctx.directory, "awaiting_user")
        log(`[${hookName}] Boulder phase set to awaiting_user`, { sessionID, plan: boulderState.plan_name })

        // Inject Archiver dispatch prompt when all tasks are complete
        try {
          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              agent: "orchestrator-sisyphus",
              parts: [{ type: "text", text: ARCHIVER_DISPATCH_PROMPT.replace("${process.cwd()}", ctx.directory) }],
            },
            query: { directory: ctx.directory },
          })
          log(`[${hookName}] Archiver dispatch prompt injected`, { sessionID })
        } catch (err) {
          log(`[${hookName}] Archiver dispatch prompt failed`, { sessionID, error: String(err) })
        }
        return
      }

      const now = Date.now()

      // Check post-compact cooldown (1 minute after compact, don't remind)
      // Uses shared state from compaction-context-injector via onSummarize hook
      if (isCompactionCooldownActive(sessionID, hookName)) {
        return
      }

      if (
        state.lastContinuationInjectedAt &&
        now - state.lastContinuationInjectedAt < CONTINUATION_COOLDOWN_MS
      ) {
        log(`[${hookName}] Skipped: continuation cooldown active`, {
          sessionID,
          cooldownRemaining: CONTINUATION_COOLDOWN_MS - (now - state.lastContinuationInjectedAt),
        })
        return
      }

      if (
        await detectBlockedResponse({
          ctx,
          sessionID,
          boulderState,
          hookName,
        })
      ) {
        return
      }

      const remaining = progress.total - progress.completed

      // CRITICAL FIX: If all checkboxes are complete (remaining = 0), do NOT inject continuation
      // This prevents infinite loop when isComplete is false due to Phase status not being marked
      // but all actual tasks (checkboxes) are done
      if (remaining === 0) {
        log(`[${hookName}] All checkboxes complete (0 remaining), skipping continuation`, {
          sessionID,
          plan: boulderState.plan_name,
          total: progress.total,
          completed: progress.completed,
          isComplete: progress.isComplete,
        })
        return
      }

      state.lastContinuationInjectedAt = now
      injectContinuation(
        sessionID,
        boulderState.plan_name,
        boulderState.active_plan,
        remaining,
        progress.total,
        boulderState.agent
      )
      return
    }

    if (event.type === "message.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const agent = info?.agent as string | undefined

      if (!sessionID) return

      if (await handleCompactionAgentMessageUpdated(sessionID, agent, hookName)) {
        return
      }

      const state = sessions.get(sessionID)
      if (state) {
        state.lastEventWasAbortError = false
      }
      return
    }

    if (event.type === "message.part.updated") {
      const info = props?.info as Record<string, unknown> | undefined
      const sessionID = info?.sessionID as string | undefined
      const role = info?.role as string | undefined

      if (sessionID && role === "assistant") {
        const state = sessions.get(sessionID)
        if (state) {
          state.lastEventWasAbortError = false
        }
      }
      return
    }

    if (event.type === "tool.execute.before" || event.type === "tool.execute.after") {
      const sessionID = props?.sessionID as string | undefined
      if (sessionID) {
        const state = getState(sessionID)
        state.lastEventWasAbortError = false
        // Track last tool execution to prevent interrupting active work
        if (event.type === "tool.execute.after") {
          state.lastToolExecutionAt = Date.now()
        }
      }
      return
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        sessions.delete(sessionInfo.id)
        log(`[${hookName}] Session deleted: cleaned up`, { sessionID: sessionInfo.id })
      }
      return
    }

    // Note: Compaction is now tracked via shared compaction-state module
    // which is updated by compaction-context-injector's onSummarize hook
  }
}
