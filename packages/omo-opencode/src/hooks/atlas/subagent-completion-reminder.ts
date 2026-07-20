import type { PluginInput } from "@opencode-ai/plugin"
import { setBoulderPause } from "../../features/boulder-state"
import { classifyFinalWaveVerdict, shouldPauseForFinalWaveApproval } from "./final-wave-approval-gate"
import { readFinalWavePlanState } from "./final-wave-plan-state"
import type { SessionState } from "./types"
import {
  buildAdvanceDirective,
  buildCompletionGate,
  buildFinalWaveApprovalReminder,
  buildMissingVerdictEscalation,
  buildOrchestratorReminder,
  buildRejectedVerdictEscalation,
} from "./verification-reminders"

type CurrentTask = {
  readonly key: string
  readonly label: string
} | null

type ReminderDecision = {
  readonly leadReminder: string
  readonly followupReminder: string | null
  readonly isFinalWaveTask: boolean
  readonly isMissingFinalWaveVerdict: boolean
  readonly isRejectedFinalWaveVerdict: boolean
  readonly shouldPauseForApproval: boolean
}

export async function buildSubagentCompletionReminder(input: {
  readonly ctx: PluginInput
  readonly planPath: string
  readonly planName: string
  readonly progress: { readonly total: number; readonly completed: number }
  readonly preferredSessionId: string
  readonly originalResponse: string
  readonly orchestratorSessionId: string | undefined
  readonly currentTask: CurrentTask
  readonly sessionState: SessionState | undefined
  readonly isAlreadyVerified: boolean
  readonly autoCommit: boolean
}): Promise<ReminderDecision> {
  const shouldPauseForApproval = input.sessionState
    ? shouldPauseForFinalWaveApproval({
        planPath: input.planPath,
        taskOutput: input.originalResponse,
        sessionState: input.sessionState,
      })
    : false

  const finalWavePlanState = readFinalWavePlanState(input.planPath)
  const isFinalWaveTask = input.currentTask?.key.startsWith("final-wave:") === true
    || ((finalWavePlanState?.pendingImplementationTaskCount ?? 1) === 0
      && (finalWavePlanState?.pendingFinalWaveTaskCount ?? 0) > 0)
  const finalWaveVerdict = isFinalWaveTask
    ? classifyFinalWaveVerdict(input.originalResponse)
    : "missing"
  const isMissingFinalWaveVerdict = isFinalWaveTask && finalWaveVerdict === "missing"
  const isRejectedFinalWaveVerdict = isFinalWaveTask && finalWaveVerdict === "reject"
  const shouldPause = shouldPauseForApproval || isMissingFinalWaveVerdict || isRejectedFinalWaveVerdict

  if (input.sessionState) {
    input.sessionState.waitingForFinalWaveApproval = shouldPause
    if (shouldPause && input.sessionState.pendingRetryTimer) {
      clearTimeout(input.sessionState.pendingRetryTimer)
      input.sessionState.pendingRetryTimer = undefined
    }
  }
  if (input.orchestratorSessionId && shouldPause) {
    setBoulderPause(input.ctx.directory, {
      reason: "final_wave_approval",
      sessionId: input.orchestratorSessionId,
    })
  }

  if (isMissingFinalWaveVerdict) {
    await showFinalWaveToast(input.ctx, "Final review incomplete", "A reviewer returned no clear verdict. Boulder paused - confirm or re-run the review.")
    return {
      leadReminder: buildMissingVerdictEscalation(
        input.planName,
        input.currentTask?.label ?? "the final-wave task",
        input.preferredSessionId,
      ),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      shouldPauseForApproval,
    }
  }

  if (isRejectedFinalWaveVerdict) {
    await showFinalWaveToast(input.ctx, "Final review rejected", "A reviewer returned VERDICT: REJECT. Boulder paused - fix or ask the user how to proceed.")
    return {
      leadReminder: buildRejectedVerdictEscalation(
        input.planName,
        input.currentTask?.label ?? "the final-wave task",
        input.preferredSessionId,
      ),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      shouldPauseForApproval,
    }
  }

  if (shouldPauseForApproval) {
    return {
      leadReminder: buildFinalWaveApprovalReminder(input.planName, input.progress, input.preferredSessionId),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      shouldPauseForApproval,
    }
  }

  if (input.isAlreadyVerified) {
    return {
      leadReminder: buildAdvanceDirective(input.planName),
      followupReminder: null,
      isFinalWaveTask,
      isMissingFinalWaveVerdict,
      isRejectedFinalWaveVerdict,
      shouldPauseForApproval,
    }
  }

  if (input.currentTask && input.sessionState && !isFinalWaveTask) {
    input.sessionState.verifiedTaskKeys ??= new Set<string>()
    input.sessionState.verifiedTaskKeys.add(input.currentTask.key)
  }

  return {
    leadReminder: buildCompletionGate(input.planName, input.preferredSessionId),
    followupReminder: buildOrchestratorReminder(input.planName, input.progress, input.preferredSessionId, input.autoCommit, false),
    isFinalWaveTask,
    isMissingFinalWaveVerdict,
    isRejectedFinalWaveVerdict,
    shouldPauseForApproval,
  }
}

async function showFinalWaveToast(ctx: PluginInput, title: string, message: string): Promise<void> {
  await ctx.client.tui
    .showToast({
      body: {
        title,
        message,
        variant: "warning" as const,
        duration: 10000,
      },
    })
    .catch(() => {})
}
