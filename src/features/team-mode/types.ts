export type TeamExecutionMode = "teammode"
export type TeamRole = "leader" | "worker"
export type TeamWorkerStatus = "pending" | "running" | "idle" | "blocked" | "completed" | "failed" | "shutdown"
export type TeamTaskStatus = "pending" | "blocked" | "in_progress" | "completed" | "failed"
export type TeamPhase = "starting" | "running" | "paused" | "completed" | "shutdown"
export type TeamShutdownMode = "graceful" | "abort"

export interface TeamMailboxMessage {
  message_id: string
  from_worker: string
  to_worker: string
  body: string
  created_at: string
  delivered_at?: string
}

export interface TeamTaskClaim {
  owner: string
  token: string
  leased_until: string
}

export interface TeamTaskTransitionRecord {
  from: TeamTaskStatus
  to: TeamTaskStatus
  worker_id: string
  at: string
}

export interface TeamWorkerLaunchRecord {
  id: string
  backgroundTaskId: string
  sessionID: string
  paneId: string
  windowId: string
}

export interface TeamWorkerRecord {
  id: string
  role: TeamRole
  status: TeamWorkerStatus
  background_task_id?: string
  session_id?: string
  pane_id?: string
  window_id?: string
  claimed_task_ids: string[]
  started_at?: string
  updated_at: string
}

export interface TeamTaskRecord {
  id: string
  title: string
  source_line: number
  status: TeamTaskStatus
  owner?: string
  claim?: TeamTaskClaim
  version: number
  updated_at: string
  started_at?: string
  completed_at?: string
  result?: string
  error?: string
  transitions: TeamTaskTransitionRecord[]
}

export interface TeamManifest {
  team_id: string
  execution_mode: TeamExecutionMode
  created_at: string
  updated_at: string
  directory: string
  plan_path: string
  plan_name: string
  worktree_path?: string
  leader_session_id: string
  phase: TeamPhase
}

export interface TeamGovernanceState {
  leader_session_id: string
  allow_resume: boolean
  active_claim_lease_ms: number
  shutdown_requested_at?: string
  shutdown_mode?: TeamShutdownMode
  shutdown_requested_by?: string
  shutdown_acknowledged_at?: string
}

export interface TeamPhaseEvent {
  phase: TeamPhase
  at: string
  reason?: string
}

export interface TeamPhaseState {
  current: TeamPhase
  updated_at: string
  history: TeamPhaseEvent[]
}

export interface TeamSummaryState {
  total_tasks: number
  pending_tasks: number
  blocked_tasks: number
  running_tasks: number
  completed_tasks: number
  failed_tasks: number
  updated_at: string
}

export interface TeamMonitorState {
  worker_status: Record<string, TeamWorkerStatus>
  active_claims: Record<string, string>
  last_task_event_at?: string
  updated_at: string
}

export interface TeamRuntimeState {
  manifest: TeamManifest
  workers: TeamWorkerRecord[]
  tasks: TeamTaskRecord[]
  mailbox: TeamMailboxMessage[]
  governance: TeamGovernanceState
  phase: TeamPhaseState
  summary: TeamSummaryState
  monitor: TeamMonitorState
}

export interface InitializeTeamModeInput {
  directory: string
  leaderSessionId: string
  planPath: string
  planName: string
  worktreePath?: string
  workerCount?: number
  claimLeaseMs?: number
}

export interface LaunchTeamWorkersInput {
  sessionID: string
  parentMessageID?: string
  planName: string
  teamStatePath: string
  workerIds: string[]
  worktreePath?: string
}

export interface ClaimTeamTaskInput {
  workerId: string
  now?: string
}

export interface ClaimTeamTaskResult {
  ok: boolean
  task?: TeamTaskRecord
  claimToken?: string
  reason?: "no_pending_task" | "worker_not_found"
}

export interface TransitionTeamTaskInput {
  taskId: string
  workerId: string
  claimToken: string
  fromStatus: TeamTaskStatus
  toStatus: Exclude<TeamTaskStatus, "pending">
  expectedVersion: number
  result?: string
  error?: string
  now?: string
}

export interface MailboxMessageInput {
  fromWorker: string
  toWorker: string
  body: string
  now?: string
}

export interface ShutdownRequestInput {
  requestedBy: string
  mode?: TeamShutdownMode
  now?: string
}
