import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import { HOOK_NAME } from "./constants"
import type { BoulderLoopState, BoulderLoopOptions } from "./types"

export * from "./types"
export * from "./constants"
export { readState, writeState, clearState, incrementIteration } from "./storage"

interface SessionState {
  isRecovering?: boolean
}

function formatTimeRemaining(ms: number): string {
  if (ms <= 0) return "0m"
  const hours = Math.floor(ms / 3600000)
  const minutes = Math.floor((ms % 3600000) / 60000)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function formatDeadlineTime(deadline: number): string {
  const date = new Date(deadline)
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - BOULDER LOOP {{ITERATION}} | {{TIME_REMAINING}} until {{DEADLINE_TIME}}]

Time remaining: {{TIME_REMAINING}}
Deadline: {{DEADLINE_TIME}}

Original task:
{{PROMPT}}`

const DEADLINE_REACHED_MSG = `${SYSTEM_DIRECTIVE_PREFIX} - BOULDER LOOP COMPLETE]

Deadline reached! You may now stop.
Total iterations: {{ITERATION}}
Duration: {{DURATION}}`

export interface BoulderLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options: { deadline: number; ultrawork?: boolean }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => BoulderLoopState | null
}

export function createBoulderLoopHook(
  ctx: PluginInput,
  options?: BoulderLoopOptions
): BoulderLoopHook {
  const sessions = new Map<string, SessionState>()
  const config = options?.config
  const stateDir = config?.state_dir
  const checkSessionExists = options?.checkSessionExists
  const backgroundManager = options?.backgroundManager

  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions: { deadline: number; ultrawork?: boolean }
  ): boolean => {
    const state: BoulderLoopState = {
      active: true,
      iteration: 1,
      deadline: loopOptions.deadline,
      ultrawork: loopOptions.ultrawork,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeState(ctx.directory, state, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop started`, {
        sessionID,
        deadline: new Date(state.deadline).toISOString(),
        timeRemaining: formatTimeRemaining(state.deadline - Date.now()),
      })
    }
    return success
  }

  const cancelLoop = (sessionID: string): boolean => {
    const state = readState(ctx.directory, stateDir)
    if (!state || state.session_id !== sessionID) {
      return false
    }

    const success = clearState(ctx.directory, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop cancelled`, { sessionID, iteration: state.iteration })
    }
    return success
  }

  const getState = (): BoulderLoopState | null => {
    return readState(ctx.directory, stateDir)
  }

  const event = async ({
    event,
  }: {
    event: { type: string; properties?: unknown }
  }): Promise<void> => {
    const props = event.properties as Record<string, unknown> | undefined

    if (event.type === "session.idle") {
      const sessionID = props?.sessionID as string | undefined
      if (!sessionID) return

      const sessionState = getSessionState(sessionID)
      if (sessionState.isRecovering) {
        log(`[${HOOK_NAME}] Skipped: in recovery`, { sessionID })
        return
      }

      const state = readState(ctx.directory, stateDir)
      if (!state || !state.active) {
        return
      }

      if (state.session_id && state.session_id !== sessionID) {
        if (checkSessionExists) {
          try {
            const originalSessionExists = await checkSessionExists(state.session_id)
            if (!originalSessionExists) {
              clearState(ctx.directory, stateDir)
              log(`[${HOOK_NAME}] Cleared orphaned state from deleted session`, {
                orphanedSessionId: state.session_id,
                currentSessionId: sessionID,
              })
              return
            }
          } catch (err) {
            log(`[${HOOK_NAME}] Failed to check session existence`, {
              sessionId: state.session_id,
              error: String(err),
            })
          }
        }
        return
      }

      const hasRunningBgTasks = backgroundManager
        ? backgroundManager.getTasksByParentSession(sessionID).some(t => t.status === "running")
        : false

      if (hasRunningBgTasks) {
        log(`[${HOOK_NAME}] Skipped: background tasks still running`, { sessionID })
        return
      }

      const now = Date.now()
      const timeRemaining = state.deadline - now

      if (timeRemaining <= 0) {
        const duration = now - new Date(state.started_at).getTime()
        const durationStr = formatTimeRemaining(duration)
        
        log(`[${HOOK_NAME}] Deadline reached!`, {
          sessionID,
          iteration: state.iteration,
          duration: durationStr,
        })
        clearState(ctx.directory, stateDir)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Boulder Loop Complete!",
              message: `Deadline reached after ${state.iteration} iteration(s). Duration: ${durationStr}`,
              variant: "success",
              duration: 5000,
            },
          })
          .catch((err) => log(`[${HOOK_NAME}] Toast failed`, { error: String(err) }))

        try {
          const finalMsg = DEADLINE_REACHED_MSG
            .replace("{{ITERATION}}", String(state.iteration))
            .replace("{{DURATION}}", durationStr)

          await ctx.client.session.prompt({
            path: { id: sessionID },
            body: {
              parts: [{ type: "text", text: finalMsg }],
            },
            query: { directory: ctx.directory },
          })
        } catch (err) {
          log(`[${HOOK_NAME}] Failed to send deadline message`, { error: String(err) })
        }

        return
      }

      const newState = incrementIteration(ctx.directory, stateDir)
      if (!newState) {
        log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID })
        return
      }

      log(`[${HOOK_NAME}] Continuing loop (deadline not reached)`, {
        sessionID,
        iteration: newState.iteration,
        timeRemaining: formatTimeRemaining(timeRemaining),
        deadline: formatDeadlineTime(newState.deadline),
      })

      const continuationPrompt = CONTINUATION_PROMPT
        .replace(/\{\{ITERATION\}\}/g, String(newState.iteration))
        .replace(/\{\{TIME_REMAINING\}\}/g, formatTimeRemaining(timeRemaining))
        .replace(/\{\{DEADLINE_TIME\}\}/g, formatDeadlineTime(newState.deadline))
        .replace("{{PROMPT}}", newState.prompt)

      const finalPrompt = newState.ultrawork
        ? `ultrawork ${continuationPrompt}`
        : continuationPrompt

      await ctx.client.tui
        .showToast({
          body: {
            title: "Boulder Loop",
            message: `Iteration ${newState.iteration} | ${formatTimeRemaining(timeRemaining)} remaining`,
            variant: "info",
            duration: 2000,
          },
        })
        .catch((err) => log(`[${HOOK_NAME}] Toast failed`, { error: String(err) }))

      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: finalPrompt }],
          },
          query: { directory: ctx.directory },
        })
      } catch (err) {
        log(`[${HOOK_NAME}] Failed to inject continuation`, {
          sessionID,
          error: String(err),
        })
      }
    }

    if (event.type === "session.deleted") {
      const sessionInfo = props?.info as { id?: string } | undefined
      if (sessionInfo?.id) {
        const state = readState(ctx.directory, stateDir)
        if (state?.session_id === sessionInfo.id) {
          clearState(ctx.directory, stateDir)
          log(`[${HOOK_NAME}] Session deleted, loop cleared`, { sessionID: sessionInfo.id })
        }
        sessions.delete(sessionInfo.id)
      }
    }

    if (event.type === "session.error") {
      const sessionID = props?.sessionID as string | undefined
      const error = props?.error as { name?: string } | undefined

      if (error?.name === "MessageAbortedError") {
        if (sessionID) {
          const state = readState(ctx.directory, stateDir)
          if (state?.session_id === sessionID) {
            clearState(ctx.directory, stateDir)
            log(`[${HOOK_NAME}] User aborted, loop cleared`, { sessionID })
          }
          sessions.delete(sessionID)
        }
        return
      }

      if (sessionID) {
        const sessionState = getSessionState(sessionID)
        sessionState.isRecovering = true
        setTimeout(() => {
          sessionState.isRecovering = false
        }, 5000)
      }
    }
  }

  return {
    event,
    startLoop,
    cancelLoop,
    getState,
  }
}
