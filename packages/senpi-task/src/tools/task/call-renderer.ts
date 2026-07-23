import type { Theme } from "@code-yeongyu/senpi"

import type { ResolvedModelRecord } from "../../state"
import {
  excerptRendererPromptText,
  joinRendererTokens,
  optionalRendererText,
} from "./renderer-text"

const TASK_PROMPT_EXCERPT_WIDTH = 30

export type TaskCallArgs = {
  readonly prompt?: string
  readonly category?: string
  readonly subagent_type?: string
  readonly resolved_model?: ResolvedModelRecord
  readonly run_in_background?: boolean
}

export function formatTaskTarget(args: Pick<TaskCallArgs, "category" | "subagent_type">): string {
  const category = optionalRendererText(args.category)
  if (category !== undefined) return `category:${category}`
  const agent = optionalRendererText(args.subagent_type)
  if (agent !== undefined) return `agent:${agent}`
  return "task"
}

export function formatTaskMode(runInBackground: boolean | undefined): string {
  return runInBackground === true ? "background" : "foreground"
}

export function taskCallLines(args: TaskCallArgs): readonly string[] {
  return [taskCallLine(args, formatTaskMode(args.run_in_background))]
}

export function renderTaskCallLines(args: TaskCallArgs, theme: Pick<Theme, "italic">): readonly string[] {
  return [taskCallLine(args, theme.italic(formatTaskMode(args.run_in_background)))]
}

function taskCallLine(args: TaskCallArgs, mode: string): string {
  return joinRendererTokens(["task", taskCallTarget(args), promptToken(args.prompt), mode])
}

function taskCallTarget(args: TaskCallArgs): string | undefined {
  const category = optionalRendererText(args.category)
  if (category !== undefined) return categoryTarget(category, args.resolved_model)
  const target = formatTaskTarget(args)
  return target === "task" ? undefined : target
}

function categoryTarget(category: string, resolved: ResolvedModelRecord | undefined): string {
  if (resolved === undefined) return `category:${category}`
  const provider = optionalRendererText(resolved.provider)
  const modelId = optionalRendererText(resolved.model_id)
  const model = provider === undefined || modelId === undefined ? undefined : `${provider}/${modelId}`
  if (model === undefined) return category
  const reasoning = optionalRendererText(resolved.reasoning_effort ?? resolved.variant)
  return `${category} (${model}${reasoning === undefined ? "" : `:${reasoning}`})`
}

function promptToken(prompt: string | undefined): string | undefined {
  const normalized = optionalRendererText(prompt)
  return normalized === undefined ? undefined : `"${excerptRendererPromptText(normalized, TASK_PROMPT_EXCERPT_WIDTH)}"`
}
