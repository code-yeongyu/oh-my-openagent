import color from "picocolors"

import type { BoulderWorkStatus } from "../../features/boulder-state"
import type { BoulderCliResult, BoulderCliWork } from "./types"

function colorizeStatus(status: BoulderWorkStatus): string {
  if (status === "active") {
    return color.cyan(status)
  }

  if (status === "completed") {
    return color.green(status)
  }

  if (status === "paused") {
    return color.yellow(status)
  }

  return color.red(status)
}

function formatCurrentTask(work: BoulderCliWork): string {
  if (!work.current_task) {
    return "-"
  }

  const elapsed = work.current_task.elapsed_human
    ? ` (${work.current_task.elapsed_human})`
    : ""
  return `${work.current_task.task_title}${elapsed}`
}

function formatWorkBlock(work: BoulderCliWork): string {
  const elapsed = work.elapsed_human ?? "-"
  const progress = `${work.percentage}% (${work.completed_tasks}/${work.total_tasks})`

  return [
    `plan: ${work.plan_name}`,
    `status: ${colorizeStatus(work.status)}`,
    `progress: ${progress}`,
    `elapsed: ${elapsed}`,
    `sessions: ${work.session_count}`,
    `current task: ${formatCurrentTask(work)}`,
  ].join("\n")
}

export function formatTextOutput(result: BoulderCliResult): string {
  const separator = color.dim("----------------------------------------")
  const blocks = result.works.map((work) => formatWorkBlock(work))
  return ["boulder progress", ...blocks].join(`\n${separator}\n`)
}

export function formatJsonOutput(result: BoulderCliResult): string {
  return JSON.stringify(result, null, 2)
}

export function formatNoBoulderMessage(isJson: boolean | undefined): string {
  if (isJson) {
    return JSON.stringify({
      error: "No boulder state found.",
    })
  }

  return "No boulder state found."
}

export function formatReadErrorMessage(isJson: boolean | undefined): string {
  if (isJson) {
    return JSON.stringify({
      error: "Failed to read boulder state.",
    })
  }

  return "Failed to read boulder state."
}
