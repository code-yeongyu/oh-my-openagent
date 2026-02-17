import type { PluginInput } from "@opencode-ai/plugin"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { log } from "../../shared/logger"
import { SYSTEM_DIRECTIVE_PREFIX } from "../../shared/system-directive"
import { readState, writeState, clearState, incrementIteration } from "./storage"
import {
  HOOK_NAME,
  DEFAULT_MAX_ITERATIONS,
  DEFAULT_COMPLETION_PROMISE,
} from "./constants"
import type { ReviewLoopState, ReviewLoopOptions } from "./types"
import { getTranscriptPath as getDefaultTranscriptPath } from "../claude-code-hooks/transcript"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"

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

export * from "./types"
export * from "./constants"
export { readState, writeState, clearState, incrementIteration } from "./storage"

interface SessionState {
  isRecovering?: boolean
}

interface OpenCodeSessionMessage {
  info?: {
    role?: string
  }
  parts?: Array<{
    type: string
    text?: string
    [key: string]: unknown
  }>
}

const CONTINUATION_PROMPT = `${SYSTEM_DIRECTIVE_PREFIX} - REVIEW LOOP {{ITERATION}}/{{MAX}}]

Your previous review did not output the completion promise. Continue the review cycle.

IMPORTANT:
- Target branch: {{TARGET_BRANCH}}
- PR files (STRICT scope): {{PR_FILES}}
- When no CRITICAL/HIGH issues remain, output: <promise>{{PROMISE}}</promise>

Continue from where you left off.`

export interface ReviewLoopHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  startLoop: (
    sessionID: string,
    targetBranch: string,
    prFiles: string[],
    options?: { maxIterations?: number; completionPromise?: string }
  ) => boolean
  cancelLoop: (sessionID: string) => boolean
  getState: () => ReviewLoopState | null
}

const DEFAULT_API_TIMEOUT = 3000

export function createReviewLoopHook(
  ctx: PluginInput,
  options?: ReviewLoopOptions
): ReviewLoopHook {
  const sessions = new Map<string, SessionState>()
  const config = options?.config as { state_dir?: string; default_max_iterations?: number } | undefined
  const stateDir = config?.state_dir
  const getTranscriptPath = options?.getTranscriptPath ?? getDefaultTranscriptPath
  const apiTimeout = options?.apiTimeout ?? DEFAULT_API_TIMEOUT
  const checkSessionExists = options?.checkSessionExists

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
      const lines = content.split("\n").filter(l => l.trim())

      for (const line of lines) {
        try {
          const entry = JSON.parse(line)
          if (entry.type === "user") continue
          if (pattern.test(line)) return true
        } catch {
          continue
        }
      }
      return false
    } catch {
      return false
    }
  }

  function escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  }

  async function detectCompletionInSessionMessages(
    sessionID: string,
    promise: string
  ): Promise<boolean> {
    try {
      const response = await Promise.race([
        ctx.client.session.messages({
          path: { id: sessionID },
          query: { directory: ctx.directory },
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("API timeout")), apiTimeout)
        ),
      ])

      const messages = (response as { data?: unknown[] }).data ?? []
      if (!Array.isArray(messages)) return false

      const assistantMessages = (messages as OpenCodeSessionMessage[]).filter(
        (msg) => msg.info?.role === "assistant"
      )
      const lastAssistant = assistantMessages[assistantMessages.length - 1]
      if (!lastAssistant?.parts) return false

      const pattern = new RegExp(`<promise>\\s*${escapeRegex(promise)}\\s*</promise>`, "is")
      const responseText = lastAssistant.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("\n")

      return pattern.test(responseText)
    } catch (err) {
      log(`[${HOOK_NAME}] Session messages check failed`, { sessionID, error: String(err) })
      return false
    }
  }

  const startLoop = (
    sessionID: string,
    targetBranch: string,
    prFiles: string[],
    loopOptions?: { maxIterations?: number; completionPromise?: string }
  ): boolean => {
    const state: ReviewLoopState = {
      active: true,
      iteration: 1,
      max_iterations:
        loopOptions?.maxIterations ?? config?.default_max_iterations ?? DEFAULT_MAX_ITERATIONS,
      completion_promise: loopOptions?.completionPromise ?? DEFAULT_COMPLETION_PROMISE,
      started_at: new Date().toISOString(),
      prompt: "",
      session_id: sessionID,
      target_branch: targetBranch,
      pr_files: prFiles,
    }

    const success = writeState(ctx.directory, state, stateDir)
    if (success) {
      log(`[${HOOK_NAME}] Loop started`, {
        sessionID,
        targetBranch,
        prFiles: prFiles.length,
        maxIterations: state.max_iterations,
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

  const getState = (): ReviewLoopState | null => {
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

      const transcriptPath = getTranscriptPath(sessionID)
      const completionDetectedViaTranscript = detectCompletionPromise(transcriptPath, state.completion_promise)

      const completionDetectedViaApi = completionDetectedViaTranscript
        ? false
        : await detectCompletionInSessionMessages(sessionID, state.completion_promise)

      if (completionDetectedViaTranscript || completionDetectedViaApi) {
        log(`[${HOOK_NAME}] Completion detected!`, {
          sessionID,
          iteration: state.iteration,
          promise: state.completion_promise,
          detectedVia: completionDetectedViaTranscript ? "transcript_file" : "session_messages_api",
        })
        clearState(ctx.directory, stateDir)

        await ctx.client.tui
          .showToast({
            body: {
              title: "Review Loop Complete!",
              message: `Review completed after ${state.iteration} iteration(s)`,
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
              title: "Review Loop Stopped",
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

      const prFilesStr = newState.pr_files.length > 0
        ? newState.pr_files.join("\n  - ")
        : "(none)"

      const continuationPrompt = CONTINUATION_PROMPT
        .replace("{{ITERATION}}", String(newState.iteration))
        .replace("{{MAX}}", String(newState.max_iterations))
        .replace("{{TARGET_BRANCH}}", newState.target_branch)
        .replace("{{PR_FILES}}", prFilesStr)
        .replace("{{PROMISE}}", newState.completion_promise)

      await ctx.client.tui
        .showToast({
          body: {
            title: "Review Loop",
            message: `Iteration ${newState.iteration}/${newState.max_iterations}`,
            variant: "info",
            duration: 2000,
          },
        })
        .catch(() => {})

      try {
        let agent: string | undefined
        let model: { providerID: string; modelID: string } | undefined

        try {
          const messagesResp = await ctx.client.session.messages({ path: { id: sessionID } })
          const messages = (messagesResp.data ?? []) as Array<{
            info?: { agent?: string; model?: { providerID: string; modelID: string }; modelID?: string; providerID?: string }
          }>
          for (let i = messages.length - 1; i >= 0; i--) {
            const info = messages[i].info
            if (info?.agent || info?.model || (info?.modelID && info?.providerID)) {
              agent = info.agent
              model = info.model ?? (info.providerID && info.modelID ? { providerID: info.providerID, modelID: info.modelID } : undefined)
              break
            }
          }
        } catch {
          const messageDir = getMessageDir(sessionID)
          const currentMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
          agent = currentMessage?.agent
          model = currentMessage?.model?.providerID && currentMessage?.model?.modelID
            ? { providerID: currentMessage.model.providerID, modelID: currentMessage.model.modelID }
            : undefined
        }

        await ctx.client.session.prompt({
          path: { id: sessionID },
          body: {
            ...(agent !== undefined ? { agent } : {}),
            ...(model !== undefined ? { model } : {}),
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
