import { existsSync } from "node:fs"

import {
  getBoulderFilePath,
  getBoulderWorks,
  getPlanProgress,
  readBoulderState,
  readCurrentTopLevelTask,
  resolveBoulderPlanPathForWork,
} from "../../features/boulder-state"
import type { BoulderWorkState } from "../../features/boulder-state"
import {
  formatJsonOutput,
  formatNoBoulderMessage,
  formatReadErrorMessage,
  formatTextOutput,
} from "./formatter"
import type { BoulderCliResult, BoulderCliWork, BoulderOptions } from "./types"

function formatDurationHuman(durationMs: number): string {
  if (durationMs < 1000) {
    return `${durationMs}ms`
  }

  const totalSeconds = Math.floor(durationMs / 1000)
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`
  }

  if (minutes > 0) {
    return `${minutes}m ${seconds}s`
  }

  return `${seconds}s`
}

function getElapsedMs(work: BoulderWorkState): number | undefined {
  if (work.elapsed_ms !== undefined) {
    return work.elapsed_ms
  }

  const startedAtMs = Date.parse(work.started_at)
  if (Number.isNaN(startedAtMs)) {
    return undefined
  }

  const endedAtMs = work.ended_at ? Date.parse(work.ended_at) : Date.now()
  if (Number.isNaN(endedAtMs)) {
    return undefined
  }

  return Math.max(0, endedAtMs - startedAtMs)
}

function buildCliWork(directory: string, work: BoulderWorkState): BoulderCliWork {
  const planPath = resolveBoulderPlanPathForWork(directory, work)
  const progress = getPlanProgress(planPath)
  const elapsedMs = getElapsedMs(work)
  const currentTask = readCurrentTopLevelTask(planPath)
  const taskSession = currentTask ? work.task_sessions?.[currentTask.key] : undefined

  let currentTaskElapsedHuman: string | undefined
  if (taskSession?.elapsed_ms !== undefined) {
    currentTaskElapsedHuman = formatDurationHuman(taskSession.elapsed_ms)
  } else if (taskSession?.started_at) {
    const startedAtMs = Date.parse(taskSession.started_at)
    if (!Number.isNaN(startedAtMs)) {
      currentTaskElapsedHuman = formatDurationHuman(Math.max(0, Date.now() - startedAtMs))
    }
  }

  return {
    work_id: work.work_id,
    plan_name: work.plan_name,
    active_plan: work.active_plan,
    worktree_path: work.worktree_path,
    status: work.status ?? "active",
    started_at: work.started_at,
    ended_at: work.ended_at,
    elapsed_ms: elapsedMs,
    elapsed_human: elapsedMs !== undefined ? formatDurationHuman(elapsedMs) : undefined,
    total_tasks: progress.total,
    completed_tasks: progress.completed,
    remaining_tasks: Math.max(0, progress.total - progress.completed),
    percentage: progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0,
    session_count: work.session_ids.length,
    current_task: currentTask
      ? {
        task_key: currentTask.key,
        task_title: currentTask.title,
        elapsed_human: currentTaskElapsedHuman,
      }
      : undefined,
  }
}

export async function boulder(options: BoulderOptions): Promise<number> {
  const directory = options.directory ?? process.cwd()
  const boulderFilePath = getBoulderFilePath(directory)
  const state = readBoulderState(directory)
  if (!state) {
    const message = existsSync(boulderFilePath)
      ? formatReadErrorMessage(options.json)
      : formatNoBoulderMessage(options.json)

    process.stderr.write(`${message}\n`)
    return existsSync(boulderFilePath) ? 2 : 1
  }

  const works = getBoulderWorks(state)
  const filteredWorks = options.workId
    ? works.filter((work) => work.work_id === options.workId)
    : works

  if (filteredWorks.length === 0) {
    process.stderr.write(`${formatNoBoulderMessage(options.json)}\n`)
    return 1
  }

  const cliWorks = filteredWorks.map((work) => buildCliWork(directory, work))
  const result: BoulderCliResult = { works: cliWorks }

  const output = options.json
    ? formatJsonOutput(result)
    : formatTextOutput(result)

  process.stdout.write(`${output}\n`)
  return 0
}
