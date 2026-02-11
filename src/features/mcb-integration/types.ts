export const MCB_TOOL_NAMES = [
  "index",
  "search",
  "validate",
  "memory",
  "session",
  "agent",
  "project",
  "vcs",
  "vcs_entity",
  "plan_entity",
  "issue_entity",
  "org_entity",
] as const

export type McbToolName = (typeof MCB_TOOL_NAMES)[number]
export type McbSearchResource = "code" | "memory" | "context"
export type McbMemoryAction = "store" | "get" | "list" | "timeline" | "inject"
export type McbMemoryResource = "observation" | "execution" | "quality_gate" | "error_pattern" | "session"
export type McbIndexAction = "start" | "status" | "clear"
export type McbValidateAction = "run" | "list_rules" | "analyze"
export type McbValidateScope = "file" | "project"
export type McbVcsAction =
  | "list_repositories"
  | "index_repository"
  | "compare_branches"
  | "search_branch"
  | "analyze_impact"
export type McbSessionAction = "create" | "get" | "update" | "list" | "summarize"

export interface McbSearchArgs {
  query: string
  resource: McbSearchResource
  collection: string
  extensions: string[]
  filters: string[]
  limit: number
  min_score: number
  tags: string[]
  session_id: string
  token: string
  org_id?: string | null
}

export interface McbMemoryArgs {
  action: McbMemoryAction
  resource: McbMemoryResource
  data: Record<string, unknown>
  ids: string[]
  project_id: string
  repo_id: string
  session_id: string
  tags: string[]
  query: string
  anchor_id: string
  depth_before: number
  depth_after: number
  window_secs: number
  observation_types: string[]
  max_tokens: number
  limit: number
  org_id?: string | null
}

export interface McbIndexArgs {
  action: McbIndexAction
  path: string
  collection: string
  extensions: string[]
  exclude_dirs: string[]
  ignore_patterns: string[]
  max_file_size: number
  follow_symlinks: boolean
  token: string
}

export interface McbValidateArgs {
  action: McbValidateAction
  scope: McbValidateScope
  path: string
  rules: string[]
  category: string
}

export interface McbVcsArgs {
  action: McbVcsAction
  repo_id: string
  repo_path: string
  base_branch: string
  target_branch: string
  query: string
  branches: string[]
  include_commits: boolean
  depth: number
  limit: number
  org_id?: string | null
}

export interface McbSessionArgs {
  action: McbSessionAction
  session_id: string
  data: Record<string, unknown>
  project_id: string
  worktree_id: string
  agent_type: string
  status: string
  limit: number
  org_id?: string | null
}

export interface McbTextContent {
  type: string
  text: string
}

export interface McbCallToolResult {
  content: McbTextContent[]
  isError?: boolean
}

export type McbSearchParams = McbSearchArgs
export interface McbMemoryStoreParams extends McbMemoryArgs {
  action: "store"
}
export type McbIndexParams = McbIndexArgs
export type McbValidateParams = McbValidateArgs

export interface McbToolAvailability {
  search: boolean
  memory: boolean
  index: boolean
  validate: boolean
  vcs: boolean
  session: boolean
}

export interface McbAvailabilityStatus {
  available: boolean
  checkedAt: number
  tools: McbToolAvailability
}
