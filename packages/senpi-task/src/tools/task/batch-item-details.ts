import type { PlanResolutionError, StartResult } from "../../manager"
import type { ResolvedSpawnItem, TaskSkillSummary, TaskToolItemDetail } from "./types"

export type StartedResult = Extract<StartResult, { kind: "started" }>
export type FailedStartResult = Exclude<StartResult, StartedResult>

export function itemError(
  item: ResolvedSpawnItem,
  taskId: string,
  message: string,
  skills?: TaskSkillSummary,
): TaskToolItemDetail {
  return {
    task_id: taskId,
    ...(item.name !== undefined && { name: item.name }),
    status: "error",
    error_message: message,
    ...(skills === undefined ? {} : { skills }),
  }
}

export function failedStartDetail(item: ResolvedSpawnItem, start: FailedStartResult, skills?: TaskSkillSummary): TaskToolItemDetail {
  switch (start.kind) {
    case "plan_unresolved": {
      return itemError(item, "", start.error.message + categoryListSuffix(start.error), skills)
    }
    case "depth_denied":
      return itemError(item, "", start.reason, skills)
    case "start_failed":
      return {
        task_id: start.task_id,
        name: start.name,
        status: "error",
        error_message: start.error_message,
        ...(skills === undefined ? {} : { skills }),
      }
    case "residency_denied":
      return itemError(item, "", start.reason, skills)
  }
}

export function startedDetail(item: ResolvedSpawnItem, start: StartedResult, skills?: TaskSkillSummary): TaskToolItemDetail {
  return {
    task_id: start.task_id,
    name: start.name,
    ...(item.task_summary === undefined ? {} : { task_summary: item.task_summary }),
    ...(item.kind === "category" ? { category: item.category } : { subagent_type: item.subagentType }),
    ...(item.model === undefined ? {} : { model: item.model }),
    ...(start.resolved_model === undefined ? {} : { resolved_model: start.resolved_model }),
    status: start.status,
    ...(start.queue_position !== undefined && { queue_position: start.queue_position }),
    ...(skills === undefined ? {} : { skills }),
  }
}

function categoryListSuffix(error: PlanResolutionError): string {
  const available = error.availableCategories
  if (available === undefined || available.length === 0) return ""
  // A model_unavailable failure means the category name IS valid; listing it under "Available
  // categories" told models to retry the same broken binding. Name the vocabulary honestly and
  // point at the omo.json config escape hatch.
  if (error.code === "model_unavailable") {
    return ` Valid category names: ${available.join(", ")}. Retry one of these, or configure categories.<name>.models in omo.json — model overrides cannot be combined with category.`
  }
  return ` Available categories: ${available.join(", ")}.`
}
