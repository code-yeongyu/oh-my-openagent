import { clampTaskSummary } from "../../task-summary"
import type { TaskToolParamsStatic } from "./params"

type TaskItem = NonNullable<TaskToolParamsStatic["tasks"]>[number]

const PROVIDER_PADDING_PROMPTS = new Set(["unused", "placeholder", "not used", "n/a"])

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonBlankText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function identifier(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : undefined
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.flatMap((entry) => {
    const normalized = identifier(entry)
    return normalized === undefined ? [] : [normalized]
  })
  return strings.length > 0 ? strings : undefined
}

function summaryText(value: unknown): string | undefined {
  return clampTaskSummary(typeof value === "string" ? value : undefined)
}

// A batch item whose prompt is missing or blank is NOT dropped here. Normalization is a serializer
// cleanup pass, not a validation gate: silently discarding the item made the tool spawn fewer
// children than submitted and report success. The item is preserved with an empty prompt so
// resolveSpawnItems can reject the whole call and name the offending index.
function taskItem(value: unknown): TaskItem | undefined {
  if (!isRecord(value)) return undefined
  const prompt = nonBlankText(value.prompt) ?? ""

  const taskSummary = summaryText(value.task_summary)
  const description = nonBlankText(value.description)
  const category = identifier(value.category)
  const subagentType = identifier(value.subagent_type)
  const name = identifier(value.name)
  const model = identifier(value.model)
  const loadSkills = stringList(value.load_skills)

  return {
    prompt,
    ...(taskSummary === undefined ? {} : { task_summary: taskSummary }),
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    ...(subagentType === undefined ? {} : { subagent_type: subagentType }),
    ...(name === undefined ? {} : { name }),
    ...(model === undefined ? {} : { model }),
    ...(loadSkills === undefined ? {} : { load_skills: loadSkills }),
  }
}

function taskItems(value: unknown): TaskItem[] | undefined {
  if (!Array.isArray(value)) return undefined
  return value.flatMap((entry) => {
    const normalized = taskItem(entry)
    return normalized === undefined ? [] : [normalized]
  })
}

// Provider padding is a CONTENTLESS filler item, not a malformed real one. A blank prompt alone is
// not enough to classify: an item carrying a name, description, category, target, model, skills or
// summary is work the caller meant to spawn, so it reaches validation and is reported rather than
// absorbed here. That content check applies ONLY to blank prompts. A known padding token still wins
// outright, because observed provider padding fills those sibling fields with junk too, so a token
// item carrying content is still absorbed.
function isProviderPaddingTask(item: TaskItem): boolean {
  const prompt = item.prompt.trim().toLowerCase()
  if (PROVIDER_PADDING_PROMPTS.has(prompt)) return true
  if (prompt.length > 0) return false
  return (
    item.task_summary === undefined &&
    item.description === undefined &&
    item.category === undefined &&
    item.subagent_type === undefined &&
    item.name === undefined &&
    item.model === undefined &&
    item.load_skills === undefined
  )
}

export function normalizeTaskToolArguments(raw: unknown): TaskToolParamsStatic {
  if (!isRecord(raw)) return {}

  const rawPrompt = typeof raw.prompt === "string" ? raw.prompt : undefined
  const prompt = nonBlankText(rawPrompt)
  const normalizedTasks = taskItems(raw.tasks)
  const tasksAreSinglePadding =
    prompt !== undefined &&
    normalizedTasks !== undefined &&
    (normalizedTasks.length === 0 || normalizedTasks.every(isProviderPaddingTask))
  const tasks = tasksAreSinglePadding ? undefined : normalizedTasks
  const taskSummary = summaryText(raw.task_summary)
  const description = nonBlankText(raw.description)
  const category = identifier(raw.category)
  const subagentType = identifier(raw.subagent_type)
  const name = identifier(raw.name)
  const model = identifier(raw.model)
  const loadSkills = stringList(raw.load_skills)
  const runInBackground = typeof raw.run_in_background === "boolean" ? raw.run_in_background : undefined

  return {
    ...(prompt === undefined ? {} : { prompt }),
    ...(taskSummary === undefined ? {} : { task_summary: taskSummary }),
    ...(description === undefined ? {} : { description }),
    ...(category === undefined ? {} : { category }),
    ...(subagentType === undefined ? {} : { subagent_type: subagentType }),
    ...(runInBackground === undefined ? {} : { run_in_background: runInBackground }),
    ...(name === undefined ? {} : { name }),
    ...(model === undefined ? {} : { model }),
    ...(loadSkills === undefined ? {} : { load_skills: loadSkills }),
    ...(tasks === undefined ? {} : { tasks }),
  }
}
