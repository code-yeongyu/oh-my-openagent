import { statSync } from "node:fs"
import {
  appendSessionId,
  clearBoulderState,
  createBoulderState,
  findPrometheusPlans,
  getPlanName,
  getPlanProgress,
  getTaskSessionState,
  readBoulderState,
  readCurrentTopLevelTask,
  upsertTaskSessionState,
  writeBoulderState,
} from "../../features/boulder-state"
import { log } from "../../shared/logger"
import { createWorktreeActiveBlock } from "./worktree-block"
import type { PluginInput } from "@opencode-ai/plugin"
import { HOOK_NAME } from "./start-work-hook"

function normalizePlanLookupValue(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^\p{L}\p{N}-]+/gu, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
}

function findPlanByName(plans: string[], requestedName: string): string | null {
  const lowerName = requestedName.toLowerCase()
  const normalizedRequestedName = normalizePlanLookupValue(requestedName)
  const exactMatch = plans.find((p) => getPlanName(p).toLowerCase() === lowerName)
  if (exactMatch) return exactMatch
  const normalizedExactMatch = plans.find((planPath) =>
    normalizePlanLookupValue(getPlanName(planPath)) === normalizedRequestedName,
  )
  if (normalizedExactMatch) return normalizedExactMatch
  const partialMatch = plans.find((p) => getPlanName(p).toLowerCase().includes(lowerName))
  if (partialMatch) return partialMatch

  const normalizedPartialMatch = plans.find((planPath) =>
    normalizePlanLookupValue(getPlanName(planPath)).includes(normalizedRequestedName),
  )
  return normalizedPartialMatch || null
}

function buildAutoSelectedPlanContext(params: {
  planPath: string
  sessionId: string
  timestamp: string
  activeAgent: string
  worktreePath: string | undefined
  worktreeBlock: string
  directory: string
}): string {
  const { planPath, sessionId, timestamp, activeAgent, worktreePath, worktreeBlock, directory } = params
  const progress = getPlanProgress(planPath)
  const newState = createBoulderState(planPath, sessionId, activeAgent, worktreePath)
  writeBoulderState(directory, newState)

  return `
## Auto-Selected Plan

**Plan**: ${getPlanName(planPath)}
**Path**: ${planPath}
**Progress**: ${progress.completed}/${progress.total} tasks
**Session ID**: ${sessionId}
**Started**: ${timestamp}
${worktreeBlock}

boulder.json has been created. Read the plan and begin execution.`
}

function buildMissingPlanContext(explicitPlanName: string, allPlans: string[]): string {
  const incompletePlans = allPlans.filter((p) => !getPlanProgress(p).isComplete)
  if (incompletePlans.length > 0) {
    const planList = incompletePlans
      .map((p, i) => {
        const prog = getPlanProgress(p)
        return `${i + 1}. [${getPlanName(p)}] - Progress: ${prog.completed}/${prog.total}`
      })
      .join("\n")

    return `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".

Available incomplete plans:
${planList}

Ask the user which plan to work on.`
  }

  return `
## Plan Not Found

Could not find a plan matching "${explicitPlanName}".
No incomplete plans available. Create a new plan with: /plan "your task"`
}

function buildExplicitPlanContext(params: {
  explicitPlanName: string
  existingState: ReturnType<typeof readBoulderState>
  sessionId: string
  timestamp: string
  activeAgent: string
  worktreePath: string | undefined
  worktreeBlock: string
  directory: string
}): string {
  const { explicitPlanName, existingState, sessionId, timestamp, activeAgent, worktreePath, worktreeBlock, directory } = params
  log(`[${HOOK_NAME}] Explicit plan name requested: ${explicitPlanName}`, { sessionID: sessionId })

  const allPlans = findPrometheusPlans(directory)
  const matchedPlan = findPlanByName(allPlans, explicitPlanName)
  if (!matchedPlan) {
    return buildMissingPlanContext(explicitPlanName, allPlans)
  }

  const progress = getPlanProgress(matchedPlan)
  if (progress.isComplete) {
    return `
## Plan Already Complete

The requested plan "${getPlanName(matchedPlan)}" has been completed.
All ${progress.total} tasks are done. Create a new plan with: /plan "your task"`
  }

  if (existingState) {
    clearBoulderState(directory)
  }

  return buildAutoSelectedPlanContext({
    planPath: matchedPlan,
    sessionId,
    timestamp,
    activeAgent,
    worktreePath,
    worktreeBlock,
    directory,
  })
}

function buildExistingSessionContext(params: {
  existingState: NonNullable<ReturnType<typeof readBoulderState>>
  sessionId: string
  activeAgent: string
  worktreePath: string | undefined
  worktreeBlock: string
  directory: string
}): string {
  const { existingState, sessionId, activeAgent, worktreePath, worktreeBlock, directory } = params
  const progress = getPlanProgress(existingState.active_plan)
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

  const worktreeDisplay = effectiveWorktree
    ? (worktreeBlock || createWorktreeActiveBlock(effectiveWorktree))
    : worktreeBlock

  return `
## Active Work Session Found

**Status**: RESUMING existing work
**Plan**: ${existingState.plan_name}
**Path**: ${existingState.active_plan}
**Progress**: ${progress.completed}/${progress.total} tasks completed
**Sessions**: ${existingState.session_ids.length + 1} (current session appended)
**Started**: ${existingState.started_at}
${worktreeDisplay}

The current session (${sessionId}) has been added to session_ids.
Read the plan file and continue from the first unchecked task.`
}

function shouldDiscoverPlans(
  existingState: ReturnType<typeof readBoulderState>,
  explicitPlanName: string | null,
): boolean {
  return (!existingState && !explicitPlanName)
    || (existingState !== null && !explicitPlanName && getPlanProgress(existingState.active_plan).isComplete)
}

function buildPlanDiscoveryContext(params: {
  contextInfo: string
  sessionId: string
  timestamp: string
  activeAgent: string
  worktreePath: string | undefined
  worktreeBlock: string
  directory: string
}): string {
  const { contextInfo, sessionId, timestamp, activeAgent, worktreePath, worktreeBlock, directory } = params
  const plans = findPrometheusPlans(directory)
  const incompletePlans = plans.filter((p) => !getPlanProgress(p).isComplete)

  if (plans.length === 0) {
    return contextInfo + `
## No Plans Found

No Prometheus plan files found at .sisyphus/plans/
Use Prometheus to create a work plan first: /plan "your task"`
  }

  if (incompletePlans.length === 0) {
    return contextInfo + `

## All Plans Complete

All ${plans.length} plan(s) are complete. Create a new plan with: /plan "your task"`
  }

  if (incompletePlans.length === 1) {
    return contextInfo + buildAutoSelectedPlanContext({
      planPath: incompletePlans[0],
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory,
    })
  }

  const planList = incompletePlans
    .map((p, i) => {
      const progress = getPlanProgress(p)
      const modified = new Date(statSync(p).mtimeMs).toISOString()
      return `${i + 1}. [${getPlanName(p)}] - Modified: ${modified} - Progress: ${progress.completed}/${progress.total}`
    })
    .join("\n")

  return contextInfo + `

<system-reminder>
## Multiple Plans Found

Current Time: ${timestamp}
Session ID: ${sessionId}

${planList}

Ask the user which plan to work on. Present the options above and wait for their response.
${worktreeBlock}
</system-reminder>`
}

export function buildStartWorkContextInfo(params: {
  ctx: PluginInput
  explicitPlanName: string | null
  existingState: ReturnType<typeof readBoulderState>
  sessionId: string
  timestamp: string
  activeAgent: string
  worktreePath: string | undefined
  worktreeBlock: string
}): string {
  const { ctx, explicitPlanName, existingState, sessionId, timestamp, activeAgent, worktreePath, worktreeBlock } = params

  let contextInfo = ""
  if (explicitPlanName) {
    contextInfo = buildExplicitPlanContext({
      explicitPlanName,
      existingState,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory: ctx.directory,
    })
  } else if (existingState) {
    contextInfo = buildExistingSessionContext({
      existingState,
      sessionId,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory: ctx.directory,
    })
  }

  if (shouldDiscoverPlans(existingState, explicitPlanName)) {
    return buildPlanDiscoveryContext({
      contextInfo,
      sessionId,
      timestamp,
      activeAgent,
      worktreePath,
      worktreeBlock,
      directory: ctx.directory,
    })
  }

  return contextInfo
}
