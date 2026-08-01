import { resolveExecutionMode } from "../../manager"
import type { ExecutionMode, ManagerStartSpec } from "../../manager"
import type { TaskToolParamsStatic } from "./params"
import { createFsSkillLoader } from "./skills"
import type { ResolvedSpawnItem, TaskToolDeps } from "./types"

type SingleSpawnParams = Omit<TaskToolParamsStatic, "prompt" | "tasks"> & { readonly prompt: string }

export type ResolvedManagerStartSpec = ManagerStartSpec & { readonly execution_mode: ExecutionMode }

export function buildStartSpec(
  params: SingleSpawnParams,
  target: { readonly category: string } | { readonly subagentType: string },
  parentSessionId: string,
  deps: TaskToolDeps,
  cwd: string,
): ResolvedManagerStartSpec {
  const ancestry = deps.resolveAncestry?.(parentSessionId)
  const loadSkills = deps.loadSkills ?? createFsSkillLoader()
  const skills = loadSkills(params.load_skills ?? [], cwd)
  const executionMode = resolvedTaskExecutionMode(target, deps)
  return {
    prompt: skills.prepend + params.prompt,
    ...(params.task_summary !== undefined && { task_summary: params.task_summary }),
    parent_session_id: parentSessionId,
    root_session_id: ancestry?.rootSessionId ?? parentSessionId,
    depth: (ancestry?.depth ?? 0) + 1,
    ...("category" in target ? { category: target.category } : { subagent_type: target.subagentType }),
    execution_mode: executionMode,
    ...(params.model !== undefined && { model: params.model }),
    ...(params.name !== undefined && { name: params.name }),
    ...(params.description !== undefined && { description: params.description }),
    ...(params.run_in_background !== undefined && { run_in_background: params.run_in_background }),
  }
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
): ExecutionMode {
  const agentMode = resolvedAgentMode(target, deps)
  return resolveExecutionMode({
    ...(agentMode !== undefined && { agentMode }),
    configMode: deps.omoConfig.task?.default_execution_mode,
  })
}

export function singleSpawnParams(item: ResolvedSpawnItem, runInBackground: boolean | undefined): SingleSpawnParams {
  return {
    prompt: item.prompt,
    ...(item.kind === "category" ? { category: item.category } : { subagent_type: item.subagentType }),
    ...(item.task_summary !== undefined && { task_summary: item.task_summary }),
    ...(item.description !== undefined && { description: item.description }),
    ...(item.name !== undefined && { name: item.name }),
    ...(item.model !== undefined && { model: item.model }),
    load_skills: [...item.load_skills],
    ...(runInBackground !== undefined && { run_in_background: runInBackground }),
  }
}

