import type { ThemeColor } from "@code-yeongyu/senpi"

import type { TaskToolDetails } from "./types"

type CallArgs = {
  readonly prompt?: string
  readonly category?: string
  readonly subagent_type?: string
  readonly run_in_background?: boolean
}

type LinesComponent = {
  render(width: number): string[]
  invalidate(): void
}

const STATUS_COLORS: Readonly<Record<string, ThemeColor>> = {
  completed: "success",
  error: "error",
  lost: "error",
  cancelled: "warning",
  interrupted: "warning",
  running: "accent",
  pending: "muted",
}

export function statusThemeColor(status: string): ThemeColor {
  return Object.hasOwn(STATUS_COLORS, status) ? STATUS_COLORS[status] : "muted"
}

export function taskCallLines(args: CallArgs): readonly string[] {
  const target = args.category !== undefined
    ? `category:${args.category}`
    : args.subagent_type !== undefined
      ? `agent:${args.subagent_type}`
      : "task"
  const mode = args.run_in_background === true ? "background" : "foreground"
  return [`${target} (${mode})`]
}

export function taskResultLines(details: TaskToolDetails): readonly string[] {
  return [`task ${details.task_id}: ${details.status}`]
}

// Minimal senpi Component wrapper: fixed lines, no interactivity. Width is accepted for the
// Component contract but the task summary is a single short row that never needs wrapping.
export function linesComponent(lines: readonly string[]): LinesComponent {
  return {
    render: (_width: number): string[] => [...lines],
    invalidate: (): void => {},
  }
}
