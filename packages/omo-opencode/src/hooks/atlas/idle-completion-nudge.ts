import type { PluginInput } from "@opencode-ai/plugin"
import type { BoulderState } from "../../features/boulder-state"
import {
  completeBoulder,
  formatDurationHuman,
  getWorkById,
  getWorkForSession,
} from "../../features/boulder-state"
import {
  isAgentRegistered,
  resolveRegisteredAgentName,
} from "../../features/claude-code-session-state"
import { collectWorktreeDirtyStatus, createInternalAgentContinuationTextPart } from "../../shared"
import { log } from "../../shared/logger"
import { isAmbiguousPostDispatchPromptFailure } from "../../shared/prompt-failure-classifier"
import { dispatchInternalPrompt, isInternalPromptDispatchAccepted } from "../shared/prompt-async-gate"
import { shouldPromptAfterSessionIdle } from "../shared/session-idle-settle"
import { HOOK_NAME } from "./hook-name"
import { BOULDER_COMPLETE_PROMPT } from "./system-reminder-templates"
import type { AtlasHookOptions, SessionState } from "./types"

function getTaskLabelSortValue(taskLabel: string): number {
  const parsed = Number.parseInt(taskLabel.replace(/[^0-9]/g, ""), 10)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : parsed
}

export async function handleCompletedBoulderIdle(input: {
  ctx: PluginInput
  options?: AtlasHookOptions
  sessionID: string
  sessionState: SessionState
  boulderState: BoulderState
}): Promise<void> {
  const { ctx, options, sessionID, sessionState, boulderState } = input
  if (sessionState.pendingRetryTimer) {
    clearTimeout(sessionState.pendingRetryTimer)
    sessionState.pendingRetryTimer = undefined
  }

  const sessionWork = getWorkForSession(ctx.directory, sessionID)
  const activeWork = !sessionWork && boulderState.active_work_id
    ? getWorkById(ctx.directory, boulderState.active_work_id)
    : null
  const work = sessionWork ?? activeWork
  if (work?.status === "abandoned") {
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
    return
  }

  if (work) {
    completeBoulder(ctx.directory, work.work_id)
  } else {
    completeBoulder(ctx.directory, boulderState.active_work_id)
  }

  if (!work) {
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
    return
  }

  if (options?.isContinuationStopped?.(sessionID)) {
    log(`[${HOOK_NAME}] Boulder completion nudge skipped because continuation stopped`, {
      sessionID,
      plan: boulderState.plan_name,
    })
    return
  }

  if (sessionState.boulderCompletionNudgedAt?.[work.work_id]) {
    log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
    return
  }

  const elapsedMilliseconds = work.elapsed_ms ?? (Date.now() - new Date(work.started_at).getTime())
  const elapsedHuman = formatDurationHuman(elapsedMilliseconds)

  const taskBreakdown = Object.values(work.task_sessions ?? {})
    .sort((left, right) => {
      const leftSortValue = getTaskLabelSortValue(left.task_label)
      const rightSortValue = getTaskLabelSortValue(right.task_label)
      if (leftSortValue !== rightSortValue) {
        return leftSortValue - rightSortValue
      }

      return left.task_label.localeCompare(right.task_label)
    })
    .map((task) => {
      if (typeof task.elapsed_ms === "number") {
        return `- ${task.task_label} ${task.task_title}: ${formatDurationHuman(task.elapsed_ms)}`
      }

      return `- ${task.task_label} ${task.task_title}: (no timing)`
    })
    .join("\n")

  const worktreeLifecycle = work.worktree_path
    ? collectWorktreeDirtyStatus(work.worktree_path)
    : null

  const worktreeLifecycleBlock =
    worktreeLifecycle?.lifecycle === "dirty"
      ? `WORKTREE LIFECYCLE: DIRTY — local-only changes remain in the worktree at ${work.worktree_path} and have NOT been merged, synced, or handed off.
git status --short in the worktree:
${worktreeLifecycle.statusShort}${worktreeLifecycle.ignoredOmoShort ? `
git status --short --ignored -- .omo (ignored OMO state files — Boulder state, evidence ledger, plans; .gitignore hides .omo/*):
${worktreeLifecycle.ignoredOmoShort}` : ""}
REQUIRED NEXT ACTION: integrate the worktree (merge into the target branch, open/update the PR, or hand off as the user instructed) BEFORE printing ORCHESTRATION COMPLETE. Do NOT print ORCHESTRATION COMPLETE while this DIRTY status is present. Do NOT claim the work is merged/synced; commit ancestry alone is not proof — filesystem changes (including ignored .omo/ state) can exist only in the worktree even when HEAD matches the target branch.`
      : worktreeLifecycle?.lifecycle === "clean"
        ? `WORKTREE LIFECYCLE: CLEAN — no local-only changes in the worktree at ${work.worktree_path}.`
        : worktreeLifecycle?.lifecycle === "unknown"
          ? `WORKTREE LIFECYCLE: UNKNOWN — could not inspect git status --short in the worktree at ${work.worktree_path}. Error: ${worktreeLifecycle.errorMessage ?? "unknown error"}. REQUIRED NEXT ACTION: inspect the worktree manually before claiming it is clean, merged, synced, or safe to remove.`
          : ""
  const prompt = BOULDER_COMPLETE_PROMPT
    .replace(/{PLAN_NAME}/g, work.plan_name)
    .replace(/{ELAPSED_HUMAN}/g, elapsedHuman)
    .replace(/{TASK_BREAKDOWN}/g, taskBreakdown.length > 0 ? taskBreakdown : "- (no task timings)")
    .replace(/{WORKTREE_LIFECYCLE}/g, worktreeLifecycleBlock)

  const atlasAgent = resolveRegisteredAgentName(
    boulderState.agent ?? (isAgentRegistered("atlas") ? "atlas" : undefined),
  )
  if (atlasAgent && isAgentRegistered(atlasAgent)) {
    if (!(await shouldPromptAfterSessionIdle(ctx.client, sessionID, options?.idleSettleMs))) {
      log(`[${HOOK_NAME}] Boulder completion nudge skipped because session is active`, { sessionID })
      return
    }

    const promptResult = await dispatchInternalPrompt({
      mode: "async",
      client: ctx.client,
      sessionID,
      source: HOOK_NAME,
      settleMs: options?.idleSettleMs,
      queueBehavior: "defer",
      input: {
        path: { id: sessionID },
        body: {
          agent: atlasAgent,
          parts: [createInternalAgentContinuationTextPart(prompt)],
        },
        query: { directory: ctx.directory },
      },
    })
    if (!isInternalPromptDispatchAccepted(promptResult)) {
      if (promptResult.status === "failed" && isAmbiguousPostDispatchPromptFailure(promptResult)) {
        sessionState.boulderCompletionNudgedAt = {
          ...(sessionState.boulderCompletionNudgedAt ?? {}),
          [work.work_id]: Date.now(),
        }
      }
      log(`[${HOOK_NAME}] Boulder completion nudge skipped by promptAsync gate`, {
        sessionID,
        status: promptResult.status,
      })
      return
    }
    sessionState.boulderCompletionNudgedAt = {
      ...(sessionState.boulderCompletionNudgedAt ?? {}),
      [work.work_id]: Date.now(),
    }
  }

  log(`[${HOOK_NAME}] Boulder complete`, { sessionID, plan: boulderState.plan_name })
}
