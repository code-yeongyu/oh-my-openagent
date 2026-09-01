import type { Theme } from "@code-yeongyu/senpi"

import { piTui } from "../../lazy/pi-tui"
import { formatTargetIdentity } from "../../status-line"
import {
  ELLIPSIS,
  excerptRendererPromptText,
  joinRendererTokens,
  optionalRendererText,
  rendererVisibleWidth,
} from "../../renderer-text"

const TASK_PROMPT_EXCERPT_WIDTH = 80

export type TaskCallArgs = {
  readonly prompt?: string
  readonly task_summary?: string
  readonly category?: string
  readonly subagent_type?: string
  readonly run_in_background?: boolean
}

export function formatTaskTarget(args: Pick<TaskCallArgs, "category" | "subagent_type">): string {
  return formatTargetIdentity({ category: args.category, agentType: args.subagent_type }) ?? "task"
}

export function formatTaskMode(runInBackground: boolean | undefined): string {
  return runInBackground === true ? "background" : "foreground"
}

export function taskCallLines(args: TaskCallArgs): readonly string[] {
  return [taskCallLine(args, formatTaskMode(args.run_in_background))]
}

export function renderTaskCallLines(
  args: TaskCallArgs,
  theme: Pick<Theme, "italic">,
  width?: number,
): readonly string[] {
  const plainMode = formatTaskMode(args.run_in_background)
  const mode = theme.italic(plainMode)
  if (width === undefined) return [taskCallLine(args, mode)]
  return [taskCallLineForWidth(args, mode, plainMode, width)]
}

// The call row is intentionally label-only: the category/model context lives in the live progress
// line (details.progress.activity) and the final result row, so repeating it here wasted the width
// that the excerpt needs. The task_summary, when present, replaces the truncated prompt so the row
// reads as WHAT was delegated instead of the prompt's first words.
function callRowText(args: TaskCallArgs): string | undefined {
  return optionalRendererText(args.task_summary) ?? optionalRendererText(args.prompt)
}

function taskCallLine(args: TaskCallArgs, mode: string): string {
  return joinRendererTokens(["task", promptToken(callRowText(args)), mode])
}

function taskCallLineForWidth(args: TaskCallArgs, mode: string, plainMode: string, width: number): string {
  if (width <= 0) return ""
  const fixedWidth = rendererVisibleWidth("task") + rendererVisibleWidth(plainMode) + 4
  const available = Math.min(TASK_PROMPT_EXCERPT_WIDTH, Math.max(0, width - fixedWidth))
  const normalized = callRowText(args)
  const prompt = normalized === undefined || available <= 0
    ? undefined
    : `"${excerptRendererPromptText(normalized, available)}"`
  return piTui().truncateToWidth(joinRendererTokens(["task", prompt, mode]), width, ELLIPSIS)
}

function promptToken(text: string | undefined): string | undefined {
  const normalized = optionalRendererText(text)
  return normalized === undefined ? undefined : `"${excerptRendererPromptText(normalized, TASK_PROMPT_EXCERPT_WIDTH)}"`
}
