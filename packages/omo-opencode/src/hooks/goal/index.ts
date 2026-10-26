import type { PluginInput } from "@opencode-ai/plugin"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import { createGoalController, type GoalController } from "./controller"
import { buildContinuationPrompt } from "./prompt"
import type { Goal } from "./types"

export type GoalHookOptions = {
  readonly projectDir: string
  readonly autoStart?: boolean
  readonly maxIterations?: number
  readonly maxStalls?: number
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
  readonly onSessionCreated: (sessionID: string, firstMessage: string) => void
  readonly event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
}

const HOOK_NAME = "goal"

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

  async function handleSessionIdle(sessionID: string): Promise<void> {
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") {
      return
    }
    const maxIterations = options.maxIterations ?? goal.maxIterations
    if (goal.iteration >= maxIterations) {
      controller.pauseGoal(sessionID)
      controller.updateProgress(sessionID, { pauseReason: "budget" })
      return
    }
    if (inFlightContinuations.has(sessionID)) {
      return
    }
    controller.updateProgress(sessionID, { iteration: goal.iteration + 1, ...(goal.stallCount > 0 ? { stallCount: 0 } : {}) })
    inFlightContinuations.add(sessionID)
    try {
      const promptText = buildContinuationPrompt(goal) + buildChildWatchdogSection(sessionID, goal)
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

  function buildChildWatchdogSection(sessionID: string, goal: Goal): string {
    if (goal.childSessionIDs.length === 0) return ""
    const lines = goal.childSessionIDs.map((childID) => {
      const child = controller.getGoal(childID)
      if (child === null) return `- ${childID}: no goal record (finished or cleared)`
      return `- ${childID}: ${child.status} (iteration ${child.iteration}/${child.maxIterations}, stalls ${child.stallCount}${child.pauseReason ? `, paused: ${child.pauseReason}` : ""})`
    })
    return ""
      + "\n\nDelegated child sessions:\n"
      + lines.join("\n")
      + "\nYou may pause, resume, or redirect a child via update_goal with its session_id.";
  }

  function handleSessionCreated(sessionID: string, firstMessage: string): void {
    if (options.autoStart !== true) return
    if (controller.getGoal(sessionID) !== null) return
    const objective = firstMessage.trim().slice(0, 2000)
    if (!objective) return
    controller.setGoal(sessionID, objective)
  }

  async function handleSessionError(sessionID: string): Promise<void> {
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") return
    const maxStalls = options.maxStalls ?? 3
    const stallCount = goal.stallCount + 1
    if (stallCount >= maxStalls) {
      controller.pauseGoal(sessionID)
      controller.updateProgress(sessionID, { stallCount, pauseReason: "stalled" })
      return
    }
    controller.updateProgress(sessionID, { stallCount })
  }

  async function handleSessionCompacted(sessionID: string): Promise<void> {
    const goal = controller.getGoal(sessionID)
    if (goal === null || goal.status !== "active") return
    await handleSessionIdle(sessionID)
  }

  async function handleSessionDeleted(sessionID: string): Promise<void> {
    const goal = controller.getGoal(sessionID)
    if (goal !== null) {
      const parentGoalID = (goal as { parentGoalID?: string }).parentGoalID
      if (typeof parentGoalID === "string" && parentGoalID.length > 0) {
        controller.markComplete(sessionID)
        return
      }
    }
    controller.clearGoal(sessionID)
  }

  return {
    setGoal: controller.setGoal,
    getGoal: controller.getGoal,
    pauseGoal: controller.pauseGoal,
    resumeGoal: controller.resumeGoal,
    clearGoal: controller.clearGoal,
    markComplete: controller.markComplete,
    onSessionCreated: (sessionID, firstMessage) => handleSessionCreated(sessionID, firstMessage),

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
        case "session.created": {
          const message = (event.properties as { message?: string })?.message ?? ""
          handleSessionCreated(sessionID, message)
          break
        }
        case "session.error":
          await handleSessionError(sessionID)
          break
        case "session.compacted":
          await handleSessionCompacted(sessionID)
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
