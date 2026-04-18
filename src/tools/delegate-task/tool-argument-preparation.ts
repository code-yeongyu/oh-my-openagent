import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { log } from "../../shared/logger"

export async function prepareDelegateTaskArgs(args: Record<string, unknown>, ctx: ToolContextWithMetadata): Promise<DelegateTaskArgs> {
  const category = typeof args.category === "string" ? args.category : undefined
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  const originalSubagentType = typeof args.subagent_type === "string" ? args.subagent_type : undefined
  let subagentType = originalSubagentType

  if (category) {
    if (subagentType && subagentType !== SISYPHUS_JUNIOR_AGENT) {
      log("[task] category provided - overriding subagent_type to sisyphus-junior", {
        category,
        subagent_type: subagentType,
      })
    }
    subagentType = SISYPHUS_JUNIOR_AGENT
  }

  let description = typeof args.description === "string" ? args.description : undefined
  if (!description || description.trim() === "") {
    const words = prompt.trim().split(/\s+/)
    description = words.slice(0, 4).join(" ") || "Delegated task"
  }

  await ctx.metadata?.({
    title: description,
  })

  const runInBackground = args.run_in_background
  if (runInBackground === undefined) {
    throw new Error("Invalid arguments: 'run_in_background' parameter is REQUIRED. Specify run_in_background=false for task delegation, or run_in_background=true for parallel exploration.")
  }

  let loadSkills = args.load_skills
  if (typeof loadSkills === "string") {
    try {
      const parsed = JSON.parse(loadSkills)
      loadSkills = Array.isArray(parsed) ? parsed : []
    } catch {
      loadSkills = []
    }
  }

  if (loadSkills === undefined) {
    throw new Error("Invalid arguments: 'load_skills' parameter is REQUIRED. Pass [] if no skills needed.")
  }

  if (loadSkills === null) {
    throw new Error("Invalid arguments: load_skills=null is not allowed. Pass [] if no skills needed.")
  }

  const normalizedLoadSkills = Array.isArray(loadSkills)
    ? loadSkills.filter((value): value is string => typeof value === "string")
    : []

  const taskID = typeof args.task_id === "string" ? args.task_id : undefined
  const command = typeof args.command === "string" ? args.command : undefined

  args.category = category
  args.subagent_type = subagentType
  args.description = description
  args.prompt = prompt
  args.run_in_background = runInBackground
  args.task_id = taskID
  args.command = command
  args.load_skills = normalizedLoadSkills

  return {
    category,
    subagent_type: subagentType,
    description,
    prompt,
    run_in_background: runInBackground === true,
    task_id: taskID,
    command,
    load_skills: normalizedLoadSkills,
  }
}
