import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { log } from "../../shared/logger"

export async function prepareDelegateTaskArgs(
  args: Record<string, unknown>,
  ctx: ToolContextWithMetadata,
): Promise<DelegateTaskArgs> {
  const category = typeof args.category === "string" ? args.category : undefined
  const prompt = typeof args.prompt === "string" ? args.prompt : ""
  const originalSubagentType = typeof args.subagent_type === "string" ? args.subagent_type : undefined
  let subagentType = originalSubagentType

  if (category && subagentType && subagentType !== SISYPHUS_JUNIOR_AGENT) {
    log("[task] category provided - overriding subagent_type to sisyphus-junior", {
      category,
      subagent_type: subagentType,
    })
  }

  if (category) {
    subagentType = SISYPHUS_JUNIOR_AGENT
  }

  let description = typeof args.description === "string" ? args.description : undefined
  let descriptionSource: DelegateTaskArgs["descriptionSource"] = "explicit"
  if (!description || description.trim() === "") {
    const words = prompt.trim().split(/\s+/)
    description = words.slice(0, 4).join(" ") || "Delegated task"
    descriptionSource = "generated"
  }

  await ctx.metadata?.({
    title: description,
  })

  // Background is the default: a foreground child blocks the parent's turn for as long as it runs, and a missing
  // flag must not fail an otherwise valid call (#4119).
  const runInBackground = args.run_in_background !== false && args.run_in_background !== "false"
  const wake = args.wake === "none" ? "none" : "each"

  let loadSkills = args.load_skills
  if (typeof loadSkills === "string") {
    try {
      const parsed = JSON.parse(loadSkills)
      loadSkills = Array.isArray(parsed) ? parsed : []
    } catch (error) {
      if (!(error instanceof Error)) throw error
      loadSkills = []
    }
  }

  if (loadSkills === undefined) {
    // Default to no skills when the field is OMITTED. Callers that don't
    // pass the field implicitly mean "no skill content needed". This is
    // what fixes the #4119 retry loop when Sisyphus / Claude Code Agent
    // SDK forget the argument.
    loadSkills = []
    log("[task] load_skills omitted; defaulting to []", {
      category: args.category,
      subagent_type: originalSubagentType,
    })
  }

  if (loadSkills === null) {
    // Explicit `null` is REJECTED loudly. The "omitted -> default, explicit
    // invalid -> throw" contract was the closing rationale of PR #1663
    // (which reverted PR #1493) and the maintainer's Oracle review on PR
    // #4121 explicitly requested we preserve it. `null` strongly signals
    // "I tried to pass something and it was wrong" - silently coercing
    // hides bugs upstream.
    throw new Error("Invalid arguments: load_skills=null is not allowed. Pass [] if no skills needed.")
  }

  const normalizedLoadSkills = Array.isArray(loadSkills)
    ? loadSkills.filter((value): value is string => typeof value === "string")
    : []

  const taskID = typeof args.task_id === "string" ? args.task_id : undefined
  const command = typeof args.command === "string" ? args.command : undefined

  return {
    category,
    subagent_type: subagentType,
    requested_subagent_type: originalSubagentType,
    description,
    descriptionSource,
    prompt,
    run_in_background: runInBackground,
    wake,
    task_id: taskID,
    command,
    load_skills: normalizedLoadSkills,
  }
}
