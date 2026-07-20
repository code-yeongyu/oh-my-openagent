export declare const BOULDER_DIR: ".omo"
export declare const BOULDER_FILE: "boulder.json"
export declare const BOULDER_STATE_PATH: ".omo/boulder.json"
export declare const NOTEPAD_DIR: "notepads"
export declare const NOTEPAD_BASE_PATH: ".omo/notepads"
export declare const PROMETHEUS_PLANS_DIR: ".omo/plans"

export type BoulderSessionOrigin = "direct" | "appended"
export type BoulderPauseReason = "final_wave_approval"
export type BoulderWorkStatus = "active" | "completed" | "paused" | "abandoned"
export type BoulderTaskStatus = "running" | "completed" | "cancelled"

export interface BoulderPauseState {
  reason: BoulderPauseReason
  session_id: string
  created_at: string
}

export interface BoulderState {
  schema_version?: 2
  active_work_id?: string
  works?: Record<string, BoulderWorkState>
  pause?: BoulderPauseState
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

export interface BoulderWorkState {
  work_id: string
  pause?: BoulderPauseState
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

export interface BoulderWorkInput {
  planPath: string
  sessionId: string
  agent?: string
  worktreePath?: string
  startedAt?: string
}

export interface TaskSessionInput {
  taskKey: string
  taskLabel: string
  taskTitle: string
  sessionId: string
  agent?: string
  category?: string
}

export interface TaskTimerInput extends TaskSessionInput {
  startedAt?: string
}

export interface BoulderPauseInput {
  reason: BoulderPauseReason
  sessionId: string
  createdAt?: string
}

export interface BoulderClearPauseInput {
  reason: BoulderPauseReason
  sessionId: string
}

export declare function readCurrentTopLevelTask(planPath: string): TopLevelTaskRef | null
export declare function getPlanChecklist(planPath: string): PlanChecklist
export declare function parsePlanChecklist(markdown: string): PlanChecklist
export declare function addBoulderWork(directory: string, input: BoulderWorkInput): BoulderState | null
export declare function appendSessionId(
  directory: string,
  sessionId: string,
  origin?: BoulderSessionOrigin,
): BoulderState | null
export declare function appendSessionIdForWork(
  directory: string,
  workId: string,
  sessionId: string,
  origin?: BoulderSessionOrigin,
): BoulderState | null
export declare function clearBoulderState(directory: string): boolean
export declare function completeBoulder(directory: string, workId?: string, endedAt?: string): BoulderState | null
export declare function createBoulderState(
  planPath: string,
  sessionId: string,
  agent?: string,
  worktreePath?: string,
): BoulderState
export declare function clearBoulderPause(directory: string, input: BoulderClearPauseInput): BoulderState | null
export declare function endTaskTimer(
  directory: string,
  workId: string,
  taskKey: string,
  endedAt?: string,
): BoulderState | null
export declare function findPrometheusPlans(directory: string): string[]
export declare function generateWorkId(planName: string): string
export declare function getActiveWorks(directory: string): BoulderWorkState[]
export declare function getBoulderFilePath(directory: string): string
export declare function getBoulderWorks(state: BoulderState): BoulderWorkState[]
export declare function getPlanName(planPath: string): string
export declare function getPlanProgress(planPath: string): PlanProgress
export declare function getTaskSessionState(directory: string, taskKey: string): TaskSessionState | null
export declare function getWorkById(directory: string, workId: string): BoulderWorkState | null
export declare function getWorkByPlanName(
  directory: string,
  planName: string,
  options?: { readonly worktreePath?: string },
): BoulderWorkState | null
export declare function getWorkForSession(directory: string, sessionId: string): BoulderWorkState | null
export declare function isBoulderPausedForSession(
  directory: string,
  input: { sessionId: string; reason: BoulderPauseReason },
): boolean
export declare function getWorkResumeOptions(directory: string): BoulderWorkResumeOption[]
export declare function normalizeSessionId(sessionId: string, platform?: "codex" | "opencode" | "senpi"): string
export declare function readBoulderState(directory: string): BoulderState | null
export declare function resolveBoulderPlanPath(
  directory: string,
  state: Pick<BoulderState, "active_plan" | "worktree_path">,
): string
export declare function resolveBoulderPlanPathForWork(
  directory: string,
  work: Pick<BoulderWorkState, "active_plan" | "worktree_path">,
): string
export declare function selectActiveWork(directory: string, workId: string): BoulderState | null
export declare function setBoulderPause(directory: string, input: BoulderPauseInput): BoulderState | null
export declare function startTaskTimer(directory: string, workId: string, input: TaskTimerInput): BoulderState | null
export declare function upsertTaskSessionState(directory: string, input: TaskSessionInput): BoulderState | null
export declare function upsertTaskSessionStateForWork(
  directory: string,
  workId: string,
  input: TaskSessionInput,
): BoulderState | null
export declare function writeBoulderState(directory: string, state: BoulderState): boolean
