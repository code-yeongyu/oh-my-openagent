export interface TeamPolicy {
  worker_launch_mode: string
  display_mode?: string
  dispatch_mode?: string
  dispatch_ack_timeout_ms?: number
}

export interface TeamGovernance {
  delegation_only?: boolean
  plan_approval_required?: boolean
  nested_teams_allowed?: boolean
  one_team_per_leader_session?: boolean
  cleanup_requires_all_workers_inactive?: boolean
}

export interface WorkerInfo {
  name: string
  index: number
  role: string
  assigned_tasks?: string[]
  pane_id?: string | null
  worker_cli?: string
  working_dir?: string
  team_state_root?: string
}

export interface WorkerStatus {
  state: string
  updated_at: string
  reason?: string
  task_id?: string
}

export interface TeamTaskClaim {
  owner: string
  token: string
  leased_until: string
}

export interface TeamTask {
  id: string
  subject: string
  description: string
  status: string
  owner: string
  role: string
  depends_on: string[]
  version: number
  created_at: string
  claim?: TeamTaskClaim
  result?: string
  error?: string
}

export interface TeamDispatchRequest {
  request_id: string
  kind: string
  team_name: string
  to_worker: string
  worker_index?: number
  pane_id?: string | null
  trigger_message?: string
  inbox_correlation_key?: string
  transport_preference?: string
  fallback_allowed?: boolean
  status?: string
  attempt_count?: number
  created_at: string
  updated_at?: string
  notified_at?: string
  last_reason?: string
}

export interface TeamMessage {
  message_id: string
  from_worker: string
  to_worker: string
  body: string
  created_at: string
  delivered_at?: string
}

export interface WorkerMailbox {
  worker: string
  messages: TeamMessage[]
}

export interface TaskApprovalRecord {
  task_id: string
  approved_by: string
  approved_at: string
  note?: string
}

export interface TeamMonitorSnapshot {
  timestamp: string
  team_name: string
  worker_count: number
  active_workers?: number
  pending_tasks?: number
  in_progress_tasks?: number
  completed_tasks?: number
  failed_tasks?: number
  blocked_workers?: string[]
  idle_workers?: string[]
}

export interface ShutdownRequest {
  requested_at: string
  requested_by: string
  reason?: string
}

export interface ShutdownAck {
  worker: string
  acknowledged_at: string
  status: string
  note?: string
}

export interface ExecutionManifest {
  schema_version: number
  name: string
  task: string
  leader?: {
    session_id?: string
    worker_id: string
    role: string
  }
  policy?: TeamPolicy
  governance?: TeamGovernance
  lifecycle_profile?: string
  tmux_session?: string
  worker_count: number
  workers: WorkerInfo[]
  created_at: string
  leader_cwd?: string
  team_state_root?: string
  workspace_mode?: string
  leader_pane_id?: string | null
  hud_pane_id?: string | null
}

export interface TeamConfig {
  name: string
  task: string
  agent_type: string
  worker_launch_mode: string
  lifecycle_profile?: string
  worker_count: number
  max_workers?: number
  workers: WorkerInfo[]
  created_at: string
  tmux_session?: string
  leader_cwd?: string
  team_state_root?: string
  workspace_mode?: string
  leader_pane_id?: string | null
  hud_pane_id?: string | null
}
