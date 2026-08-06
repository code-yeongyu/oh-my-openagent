import {
  appendSessionId,
  getPlanName,
  getPlanProgress,
  resolveBoulderPlanPath,
  writeBoulderState,
} from "../../features/boulder-state"
import type { BoulderState, BoulderWorkResumeOption } from "../../features/boulder-state"
import { createWorktreeActiveBlock } from "./worktree-block"
import { ensureNotepadScaffold } from "./notepad-scaffold"

export function buildAutoSelectedPlanContextInfoOnly(params: {
  readonly planPath: string
  readonly sessionId: string
  readonly timestamp: string
  readonly worktreeBlock: string
  readonly reason?: string
}): string {
  const { planPath, sessionId, timestamp, worktreeBlock, reason } = params
  const progress = getPlanProgress(planPath)
  const reasonLine = reason ? `**Reason**: ${reason}\n` : ""

  return `
## Auto-Selected Plan

**Plan**: ${getPlanName(planPath)}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}
${reasonLine}${worktreeBlock}

boulder.json has been created. Read the plan and begin execution.`
}

function formatElapsedHuman(elapsedMs: number | undefined): string {
  if (typeof elapsedMs !== "number" || elapsedMs <= 0) {
    return "running"
  }

  const totalSeconds = Math.floor(elapsedMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }
  return `${seconds}s`
}

export function buildMultipleActiveWorksContext(params: {
  readonly resumeOptions: readonly BoulderWorkResumeOption[]
  readonly sessionId: string
  readonly timestamp: string
}): string {
  const { resumeOptions, sessionId, timestamp } = params
  const optionList = resumeOptions
    .map((option, index) => {
      const percent =
        option.progress.total === 0
          ? 0
          : Math.floor((option.progress.completed / option.progress.total) * 100)

      return `${index + 1}. ${option.plan_name} - ${option.progress.completed}/${option.progress.total} (${percent}%) - elapsed: ${formatElapsedHuman(option.elapsed_ms)} - worktree: ${option.worktree_path ?? "current directory"} - sessions: ${option.session_count}`
    })
    .join("\n")

  return `
<system-reminder>
## Multiple Active Works Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${optionList}

Use the Question tool to ask the user which plan to resume.
- If the user chooses one option, run /start-work {plan-name} for that plan.
- If the user chooses to start a new plan, proceed with cold-start auto-selection flow.
</system-reminder>`
}

export function buildExistingSessionContext(params: {
  readonly existingState: BoulderState
  readonly sessionId: string
  readonly activeAgent: string
  readonly worktreePath: string | undefined
  readonly worktreeBlock: string
  readonly directory: string
}): string {
  const { existingState, sessionId, activeAgent, worktreePath, worktreeBlock, directory } = params
  const planPath = resolveBoulderPlanPath(directory, existingState)
  const progress = getPlanProgress(planPath)
  if (progress.isComplete) {
    return `
## Previous Work Complete

The previous plan (${existingState.plan_name}) has been completed.
Looking for new plans...`
  }

  const effectiveWorktree = worktreePath ?? existingState.worktree_path
  const sessionAlreadyTracked = existingState.session_ids.includes(sessionId)
  const updatedSessions = sessionAlreadyTracked
    ? existingState.session_ids
    : [...existingState.session_ids, sessionId]
  const shouldRewriteState = existingState.agent !== activeAgent || worktreePath !== undefined

  if (shouldRewriteState) {
    writeBoulderState(directory, {
      ...existingState,
      agent: activeAgent,
      ...(worktreePath !== undefined ? { worktree_path: worktreePath } : {}),
      session_ids: updatedSessions,
    })
  } else if (!sessionAlreadyTracked) {
    appendSessionId(directory, sessionId)
  }

  ensureNotepadScaffold({ directory, planName: existingState.plan_name })

  const worktreeDisplay = effectiveWorktree
    ? worktreeBlock || createWorktreeActiveBlock(effectiveWorktree)
    : worktreeBlock

  return `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length + 1} (current session appended)
**Started**: ${existingState.started_at}
${worktreeDisplay}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
}
