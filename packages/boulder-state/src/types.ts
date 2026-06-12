export interface BoulderState {
  schema_version?: 2
  active_work_id?: string
  works?: Record<string, BoulderWorkState>
  active_plan: string
  started_at: string
  ended_at?: string
  elapsed_ms?: number
  status?: BoulderWorkStatus
  updated_at?: string
  session_ids: string[]
  session_origins?: Record<string, "direct" | "appended">
  plan_name: string
  agent?: string
  worktree_path?: string
  task_sessions?: Record<string, TaskSessionState>
}

export type BoulderSessionOrigin = "direct" | "appended"
export type BoulderWorkStatus = "active" | "completed" | "paused" | "abandoned"
export type BoulderTaskStatus = "running" | "completed" | "cancelled"

export interface BoulderWorkState {
  work_id: string
  active_plan: string
  plan_name: string
  status?: BoulderWorkStatus
  started_at: string
  ended_at?: string
  elapsed_ms?: number
  updated_at?: string
  session_ids: string[]
  session_origins?: Record<string, BoulderSessionOrigin>
  agent?: string
  worktree_path?: string
  task_sessions?: Record<string, TaskSessionState>
}

export interface PlanProgress {
  total: number
  completed: number
  isComplete: boolean
}

export interface PlanChecklist {
  total: number
  completed: number
  remaining: number
  nextTaskLabel: string | null
}

export interface TaskSessionState {
  task_key: string
  task_label: string
  task_title: string
  session_id: string
  agent?: string
  category?: string
  started_at?: string
  ended_at?: string
  elapsed_ms?: number
  status?: BoulderTaskStatus
  updated_at: string
}

export interface BoulderWorkResumeOption {
  work_id: string
  plan_name: string
  active_plan: string
  worktree_path?: string
  status: BoulderWorkStatus
  started_at: string
  updated_at: string
  ended_at?: string
  elapsed_ms?: number
  session_count: number
  progress: PlanProgress
  is_current_mirror: boolean
}

export interface TopLevelTaskRef {
  key: string
  section: "todo" | "final-wave"
  label: string
  title: string
}
