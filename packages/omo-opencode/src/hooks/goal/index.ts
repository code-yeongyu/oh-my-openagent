import type { PluginInput } from "@opencode-ai/plugin"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import { createGoalController, type GoalController } from "./controller"
import { buildContinuationPrompt } from "./prompt"
import type { Goal } from "./types"

export type GoalHookOptions = {
  readonly projectDir: string
  readonly ultrawork?: boolean
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

function getSessionIDFromEvent(properties: unknown): string | undefined {
  if (typeof properties === "object" && properties !== null) {
    const maybe = (properties as { sessionID?: string }).sessionID
    if (typeof maybe === "string") return maybe
    const maybeId = (properties as { id?: string }).id
    if (typeof maybeId === "string") return maybeId
  }
  return undefined
}

async function resolveUltraworkPrompt(): Promise<string> {
  const { getUltraworkMessage } = await import("../keyword-detector/ultrawork")
  return getUltraworkMessage("sisyphus")
}

export function shouldActivateUltrawork(
  ultraworkEnabled: boolean | undefined,
  goalId: string,
  activatedGoals: ReadonlySet<string>,
): boolean {
  return ultraworkEnabled === true && !activatedGoals.has(goalId)
}

export function createGoalHook(ctx: PluginInput, options: GoalHookOptions): GoalHook {
  const controller: GoalController = createGoalController({ projectDir: options.projectDir })
  const inFlightContinuations = new Set<string>()
  const ultraworkActivatedGoals = new Set<string>()

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
      // Activate ultrawork once per goal: its prompt carries an activation banner that must not
      // repeat on every idle continuation. Later continuations stay in ultrawork via conversation history.
      const activateUltrawork = shouldActivateUltrawork(options.ultrawork, goal.id, ultraworkActivatedGoals)
      const ultraworkPrompt = activateUltrawork ? await resolveUltraworkPrompt() : undefined
      const promptText = buildContinuationPrompt(goal, ultraworkPrompt)
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
      const dispatchAccepted = promptResult.status !== "failed" || isInternalPromptDispatchAccepted(promptResult)
      if (activateUltrawork && dispatchAccepted) {
        // Burn the once-per-goal activation only after the banner-carrying prompt was accepted, so a
        // failed dispatch (or a resolveUltraworkPrompt import error above) retries ultrawork on the next
        // idle instead of silently downgrading to a plain continuation.
        ultraworkActivatedGoals.add(goal.id)
      }
      if (!dispatchAccepted) {
        // Log only; the dispatch may still have been accepted by another route.
        // eslint-disable-next-line no-console
        console.warn(`[${HOOK_NAME}] Idle continuation dispatch failed`, promptResult.error)
      }
    } finally {
      inFlightContinuations.delete(sessionID)
    }
  }

  async function handleSessionDeleted(sessionID: string): Promise<void> {
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
        case "session.deleted":
          await handleSessionDeleted(sessionID)
          break
        default:
          break
      }
    },
  }
}
