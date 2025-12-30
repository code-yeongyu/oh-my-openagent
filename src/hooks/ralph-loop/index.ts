import { existsSync, readFileSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"
import { log } from "../../shared/logger"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import {
  HOOK_NAME,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_COMPLETION_PROMISE,
} from "./constants"
import type { RalphLoopState, RalphLoopOptions } from "./types"
import { getTranscriptPath as getDefaultTranscriptPath } from "../claude-code-hooks/transcript"

export * from "./types"
export * from "./constants"
export { readState, writeState, clearState, incrementIteration } from "./storage"

interface SessionState {
  isRecovering?: boolean
}

const CONTINUATION_PROMPT = `[RALPH LOOP - ITERATION {{ITERATION}}/{{MAX}}]

Your previous attempt did not output the completion promise. Continue working on the task.

IMPORTANT:
- Review your progress so far
- Continue from where you left off  
- When FULLY complete, output: <promise>{{PROMISE}}</promise>
- Do not stop until the task is truly done

Original task:
{{PROMPT}}`

export interface RalphLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    prompt: string,
    options?: { maxIterations?: number; completionPromise?: string }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => RalphLoopState | null
}

export function createRalphLoopHook(
  ctx: PluginInput,
  options?: RalphLoopOptions
): RalphLoopHook {
  const sessions = new Map<string, SessionState>()
  const config = options?.config
  const stateDir = config?.state_dir
  const getTranscriptPath = options?.getTranscriptPath ?? getDefaultTranscriptPath

  function getSessionState(sessionID: string): SessionState {
    let state = sessions.get(sessionID)
    if (!state) {
      state = {}
      sessions.set(sessionID, state)
    }
    return state
  }

  function detectCompletionPromise(
    transcriptPath: string | undefined,
    promise: string
  ): boolean {
    if (!transcriptPath) return false

    try {
      if (!existsSync(transcriptPath)) return false

      const content = readFileSync(transcriptPath, "utf-8")
      const pattern = new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
      return pattern.test(content)
    } catch {
      return false
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  const startLoop = (
    sessionID: string,
    prompt: string,
    loopOptions?: { maxIterations?: number; completionPromise?: string }
  ): boolean => {
    const state: RalphLoopState = {
      active: true,
      iteration: 1,
      max_iterations:
        loopOptions?.maxIterations ?? config?.default_max_iterations ?? DEFAULT_MAX_ITERATIONS,
      completion_promise: loopOptions?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
      started_at: new Date().toISOString(),
      prompt,
      session_id: sessionID,
    }

    const success = writeState(ctx.directory, state, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop started`, {
        sessionID,
        maxIterations: state.max_iterations,
        completionPromise: state.completion_promise,
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

  const getState = (): RalphLoopState | null => {
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
        return
      }

      // Generate transcript path from sessionID - OpenCode doesn't pass it in event properties
      const transcriptPath = getTranscriptPath(sessionID)

      if (detectCompletionPromise(transcriptPath, state.completion_promise)) {
        log(`[${HOOK_NAME}] Completion detected!`, {
          sessionID,
          iteration: state.iteration,
          promise: state.completion_promise,
        })
        clearState(ctx.directory, stateDir)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Ralph Loop Complete!",
              message: `Task completed after ${state.iteration} iteration(s)`,
              variant: "success",
              duration: 5000,
            },
          })
          .catch(() => {})

        return
      }

      if (state.iteration >= state.max_iterations) {
        log(`[${HOOK_NAME}] Max iterations reached`, {
          sessionID,
          iteration: state.iteration,
          max: state.max_iterations,
        })
        clearState(ctx.directory, stateDir)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Ralph Loop Stopped",
              message: `Max iterations (${state.max_iterations}) reached without completion`,
              variant: "warning",
              duration: 5000,
            },
          })
          .catch(() => {})

        return
      }

      const newState = incrementIteration(ctx.directory, stateDir)
      if (!newState) {
        log(`[${HOOK_NAME}] Failed to increment iteration`, { sessionID })
        return
      }

      log(`[${HOOK_NAME}] Continuing loop`, {
        sessionID,
        iteration: newState.iteration,
        max: newState.max_iterations,
      })

      const continuationPrompt = CONTINUATION_PROMPT.replace("{{ITERATION}}", String(newState.iteration))
        .replace("{{MAX}}", String(newState.max_iterations))
        .replace("{{PROMISE}}", newState.completion_promise)
        .replace("{{PROMPT}}", newState.prompt)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Ralph Loop",
            message: `Iteration ${newState.iteration}/${newState.max_iterations}`,
            variant: "info",
            duration: 2000,
          },
        })
        .catch(() => {})

      try {
        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: continuationPrompt }],
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
