import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import { log } from "../../shared/logger"
import {
  extractSessionErrorInfo,
  getAbortWindowElapsedMs,
  getTranscriptContinuationSkipReason,
  isAbortSessionErrorName,
  type TranscriptContinuationSkipReason,
} from "../shared/idle-continuation-guards"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import type { MessageWithInfo } from "../todo-continuation-enforcer/types"
import { createGoalController, type GoalController } from "./controller"
import { buildContinuationPrompt } from "./prompt"
import type { Goal } from "./types"

export type GoalHookOptions = {
  readonly projectDir: string
  readonly autoStart?: boolean
  readonly ultrawork?: boolean
  readonly getSessionExists?: (sessionID: string) => Promise<boolean>
}

export type GoalHook = {
  readonly setGoal: (sessionID: string, objective: string) => Goal
  readonly getGoal: (sessionID: string) => Goal | null
  readonly pauseGoal: (sessionID: string) => Goal | null
  readonly resumeGoal: (sessionID: string) => Goal | null
  readonly clearGoal: (sessionID: string) => boolean
  readonly markComplete: (sessionID: string) => Goal | null
  readonly event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

const HOOK_NAME = "goal"

type IdleContinuationSkip =
  | { readonly reason: "abort-window"; readonly abortElapsedMs: number }
  | { readonly reason: "messages-fetch-failed"; readonly error: string }
  | { readonly reason: TranscriptContinuationSkipReason }

function getSessionIDFromEvent(properties: unknown): string | undefined {
  if (typeof properties === "object" && properties !== null) {
    const maybe = (properties as { sessionID?: string }).sessionID
    if (typeof maybe === "string") return maybe
    const maybeId = (properties as { id?: string }).id
    if (typeof maybeId === "string") return maybeId
  }
  return undefined
}

export function createGoalHook(ctx: PluginInput, options: GoalHookOptions): GoalHook {
  const controller: GoalController = createGoalController({ projectDir: options.projectDir })
  const inFlightContinuations = new Set<string>()
  const abortDetectedAt = new Map<string, number>()

  // Same skip predicates as todo-continuation-enforcer: an idle that follows a
  // user abort, an unanswered question, or a still-open assistant turn must not
  // receive an internal prompt. The goal stays active, so the user's next turn
  // resumes continuation.
  async function resolveIdleContinuationSkip(sessionID: string): Promise<IdleContinuationSkip | undefined> {
    const abortElapsedMs = getAbortWindowElapsedMs(abortDetectedAt.get(sessionID), Date.now())
    abortDetectedAt.delete(sessionID)
    if (abortElapsedMs !== undefined) {
      return { reason: "abort-window", abortElapsedMs }
    }

    let messages: MessageWithInfo[]
    try {
      const response = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      })
      messages = normalizeSDKResponse(response, [] as MessageWithInfo[])
    } catch (error) {
      return { reason: "messages-fetch-failed", error: error instanceof Error ? error.message : String(error) }
    }

    const transcriptReason = getTranscriptContinuationSkipReason(messages)
    return transcriptReason === undefined ? undefined : { reason: transcriptReason }
  }

  async function handleSessionIdle(sessionID: string): Promise<void> {
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") {
      return
    }
    if (inFlightContinuations.has(sessionID)) {
      return
    }
    inFlightContinuations.add(sessionID)
    try {
      const skip = await resolveIdleContinuationSkip(sessionID)
      if (skip !== undefined) {
        log(`[${HOOK_NAME}] Skipped idle continuation`, { sessionID, ...skip })
        return
      }
      const promptText = buildContinuationPrompt(goal)
      const promptResult = await dispatchInternalPrompt({
        mode: "async",
        client: ctx.client,
        sessionID,
        source: `${HOOK_NAME}:idle-continuation`,
        settleMs: 150,
        queueBehavior: "defer",
        input: {
          path: { id: sessionID },
          body: {
            parts: [{ type: "text", text: promptText }],
          },
        },
      })
      if (promptResult.status === "failed" && !isInternalPromptDispatchAccepted(promptResult)) {
        // Log only; the dispatch may still have been accepted by another route.
        // eslint-disable-next-line no-console
        console.warn(`[${HOOK_NAME}] Idle continuation dispatch failed`, promptResult.error)
      }
    } finally {
      inFlightContinuations.delete(sessionID)
    }
  }

  function handleSessionError(sessionID: string, error: unknown): void {
    const errorName = extractSessionErrorInfo(error)?.name
    if (!isAbortSessionErrorName(errorName)) {
      return
    }
    abortDetectedAt.set(sessionID, Date.now())
    log(`[${HOOK_NAME}] Abort detected via session.error`, { sessionID, errorName })
  }

  async function handleSessionDeleted(sessionID: string): Promise<void> {
    abortDetectedAt.delete(sessionID)
    controller.clearGoal(sessionID)
  }

  return {
    setGoal: controller.setGoal,
    getGoal: controller.getGoal,
    pauseGoal: controller.pauseGoal,
    resumeGoal: controller.resumeGoal,
    clearGoal: controller.clearGoal,
    markComplete: controller.markComplete,

    event: async (input) => {
      const { event } = input
      const sessionID = getSessionIDFromEvent(event.properties)
      if (sessionID === undefined) {
        return
      }
      switch (event.type) {
        case "session.idle":
          await handleSessionIdle(sessionID)
          break
        case "session.error":
          handleSessionError(sessionID, (event.properties as { error?: unknown }).error)
          break
        case "session.deleted":
          await handleSessionDeleted(sessionID)
          break
        default:
          break
      }
    },
  }
}
