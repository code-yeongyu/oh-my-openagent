import type { Theme } from "@code-yeongyu/senpi"
import { truncateToWidth } from "@earendil-works/pi-tui"

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
  readonly category?: string
  readonly subagent_type?: string
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

// The call row is intentionally prompt-only: the category/model context lives in the live progress
// line (details.progress.activity) and the final result row, so repeating it here wasted the width
// that the prompt excerpt needs.
function taskCallLine(args: TaskCallArgs, mode: string): string {
  return joinRendererTokens(["task", promptToken(args.prompt), mode])
}

function taskCallLineForWidth(args: TaskCallArgs, mode: string, plainMode: string, width: number): string {
  if (width <= 0) return ""
  const fixedWidth = rendererVisibleWidth("task") + rendererVisibleWidth(plainMode) + 4
  const available = Math.min(TASK_PROMPT_EXCERPT_WIDTH, Math.max(0, width - fixedWidth))
  const normalized = optionalRendererText(args.prompt)
  const prompt = normalized === undefined || available <= 0
    ? undefined
    : `"${excerptRendererPromptText(normalized, available)}"`
  return truncateToWidth(joinRendererTokens(["task", prompt, mode]), width, ELLIPSIS)
}

function promptToken(prompt: string | undefined): string | undefined {
  const normalized = optionalRendererText(prompt)
  return normalized === undefined ? undefined : `"${excerptRendererPromptText(normalized, TASK_PROMPT_EXCERPT_WIDTH)}"`
}
