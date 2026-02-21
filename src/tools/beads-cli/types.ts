export interface BdIssue {
  id: string
  title: string
  description?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  spec_id?: string
  status: BdStatus
  priority: number
  issue_type: BdIssueType
  assignee?: string
  owner?: string
  estimated_minutes?: number
  created_at: string
  created_by?: string
  updated_at: string
  closed_at?: string
  close_reason?: string
  external_ref?: string
  due_at?: string | null
  defer_until?: string | null
  labels?: string[]
  dependencies?: BdDependency[]
  comments?: BdComment[]
}

export type BdStatus =
  | "open"
  | "in_progress"
  | "blocked"
  | "deferred"
  | "closed"
  | "pinned"
  | "hooked"

export type BdIssueType =
  | "bug"
  | "feature"
  | "task"
  | "epic"
  | "chore"
  | "decision"
  | "message"

export interface BdDependency {
  issue_id: string
  depends_on_id: string
  type: BdDependencyType
  created_at: string
  created_by?: string
  metadata?: string
}

export type BdDependencyType =
  | "blocks"
  | "parent-child"
  | "conditional-blocks"
  | "waits-for"
  | "related"
  | "discovered-from"
  | "replies-to"
  | "relates-to"
  | "duplicates"
  | "supersedes"

export interface BdComment {
  id: string
  issue_id: string
  author?: string
  content: string
  created_at: string
}

export interface BdCreateOptions {
  priority?: number
  issue_type?: BdIssueType
  description?: string
  assignee?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  spec_id?: string
  external_ref?: string
  due_at?: string
  defer_until?: string
  estimated_minutes?: number
  owner?: string
  dependencies?: Array<{ type: BdDependencyType; id: string }>
}

export interface BdUpdateOptions {
  status?: BdStatus
  priority?: number
  assignee?: string
  owner?: string
  title?: string
  description?: string
  design?: string
  acceptance_criteria?: string
  notes?: string
  external_ref?: string
  due_at?: string
  defer_until?: string
  estimated_minutes?: number
  claim?: boolean
}

export interface BdCloseOptions {
  reason?: string
}

export interface BdResult<T> {
  success: boolean
  data?: T
  error?: string
}
