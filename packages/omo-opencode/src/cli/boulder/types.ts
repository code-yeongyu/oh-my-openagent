import type { BoulderWorkStatus } from "../../features/boulder-state"

export interface BoulderOptions {
  directory?: string
  workId?: string
  json?: boolean
}

export interface BoulderCliWork {
  work_id: string
  plan_name: string
  active_plan: string
  worktree_path?: string
  status: BoulderWorkStatus
  started_at: string
  ended_at?: string
  elapsed_human?: string
  elapsed_ms?: number
  total_tasks: number
  completed_tasks: number
  remaining_tasks: number
  percentage: number
  session_count: number
  current_task?: {
    task_key: string
    task_title: string
    elapsed_human?: string
  }
}

export interface BoulderCliResult {
  works: BoulderCliWork[]
}
