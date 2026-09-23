import { resolveExecutionMode } from "../../manager"
import type { ExecutionMode, ManagerStartSpec } from "../../manager"
import type { KernelToolGrant } from "../../kernel-tools/resolve"
import type { TaskToolParamsStatic } from "./params"
import { createFsSkillLoader } from "./skills"
import { taskSkillSummary } from "./skill-result"
import type { ResolvedSpawnItem, TaskSkillSummary, TaskToolDeps } from "./types"

type SingleSpawnParams = Omit<TaskToolParamsStatic, "prompt" | "tasks"> & { readonly prompt: string }

export type ResolvedManagerStartSpec = ManagerStartSpec & {
  // Absent only when omo.json says `auto` and the parent session's daemon check has not settled
  // yet: the manager then resolves it (awaiting that check) instead of the tool guessing here.
  readonly execution_mode?: ExecutionMode
  readonly skills?: TaskSkillSummary
}

export function buildStartSpec(
  params: SingleSpawnParams,
  target: { readonly category: string } | { readonly subagentType: string },
  parentSessionId: string,
  deps: TaskToolDeps,
  cwd: string,
  kernelTools?: KernelToolGrant,
): ResolvedManagerStartSpec {
  const ancestry = deps.resolveAncestry?.(parentSessionId)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const skills = loadSkills(params.load_skills ?? [], cwd)
  const skillSummary = taskSkillSummary(params.load_skills ?? [], skills)
  const executionMode = resolvedTaskExecutionMode(target, deps)
  const isolation = deps.omoConfig.task?.isolation
  const isolated = params.isolated ?? isolation?.enabled ?? false
  return {
    prompt: skills.prepend + params.prompt,
    ...(isolated ? {
      isolated,
      apply: params.apply ?? isolation?.apply ?? true,
      merge: params.merge ?? isolation?.merge ?? "patch",
    } : params.isolated === undefined ? {} : { isolated }),
    ...(skillSummary === undefined ? {} : { skills: skillSummary }),
    ...(params.task_summary !== undefined && { task_summary: params.task_summary }),
    parent_session_id: parentSessionId,
    root_session_id: ancestry?.rootSessionId ?? parentSessionId,
    depth: (ancestry?.depth ?? 0) + 1,
    ...("category" in target ? { category: target.category } : { subagent_type: target.subagentType }),
    ...(executionMode === undefined ? {} : { execution_mode: executionMode }),
    ...(params.model !== undefined && { model: params.model }),
    ...(params.name !== undefined && { name: params.name }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.run_in_background !== undefined && { run_in_background: params.run_in_background }),
    ...(kernelTools !== undefined && { kernelTools }),
  }
}

// The child's execution mode for a target, resolved exactly as buildStartSpec resolves it. The
// kernel-tool grant is decided against this same value BEFORE any child session is created, so the
// caller awaits `ensureAutoExecutionMode` first and an unresolved `auto` can only read as the
// conservative in-process (a grant is never widened by an unsettled daemon check).
export function taskExecutionModeFor(
  target: { readonly category: string } | { readonly subagentType: string },
  deps: TaskToolDeps,
): ExecutionMode {
  return resolvedTaskExecutionMode(target, deps) ?? "in-process"
}

/**
 * The parent session's ONE `auto` resolution, asked only when omo.json really says `auto`: a
 * user-set mode must never make a session ensure the shared daemon. Awaited at the tool's async
 * entry so every synchronous resolution below reads a settled value.
 */
export async function ensureAutoExecutionMode(deps: TaskToolDeps): Promise<ExecutionMode | undefined> {
  if (deps.omoConfig.task?.default_execution_mode !== "auto") return undefined
  return await deps.executionModeGate?.ensure()
}

function toExecutionMode(value: string | undefined): ExecutionMode | undefined {
  switch (value) {
    case "in-process":
    case "process":
      return value
    default:
      return undefined
  }
}

function resolvedAgentMode(
  target: { readonly category: string } | { readonly subagentType: string },
  deps: TaskToolDeps,
): ExecutionMode | undefined {
  if (!("subagentType" in target)) return undefined
  return toExecutionMode(deps.agents[target.subagentType]?.executionMode) ?? deps.omoConfig.agents?.[target.subagentType]?.execution_mode
}

function resolvedTaskExecutionMode(
  target: { readonly category: string } | { readonly subagentType: string },
  deps: TaskToolDeps,
): ExecutionMode | undefined {
  const agentMode = resolvedAgentMode(target, deps)
  const configMode = deps.omoConfig.task?.default_execution_mode
  const autoMode = deps.executionModeGate?.current()
  if (configMode === "auto" && agentMode === undefined && autoMode === undefined) return undefined
  return resolveExecutionMode({
    ...(agentMode !== undefined && { agentMode }),
    configMode,
    ...(autoMode === undefined ? {} : { autoMode }),
  })
}

export function singleSpawnParams(item: ResolvedSpawnItem, runInBackground: boolean | undefined): SingleSpawnParams {
  return {
    prompt: item.prompt,
    ...(item.isolated === undefined ? {} : { isolated: item.isolated }),
    ...(item.apply === undefined ? {} : { apply: item.apply }),
    ...(item.merge === undefined ? {} : { merge: item.merge }),
    ...(item.kind === "category" ? { category: item.category } : { subagent_type: item.subagentType }),
    ...(item.task_summary !== undefined && { task_summary: item.task_summary }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.name !== undefined && { name: item.name }),
    ...(item.model !== undefined && { model: item.model }),
    load_skills: [...item.load_skills],
    ...(runInBackground !== undefined && { run_in_background: runInBackground }),
  }
}

