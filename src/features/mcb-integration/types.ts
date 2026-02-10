export type McbSearchResource = "code" | "memory" | "context"
export type McbMemoryAction = "store" | "get" | "list" | "timeline" | "inject"

export interface McbSearchParams {
  query: string
  resource: McbSearchResource
  collection: string
  extensions?: string[]
  filters?: string[]
  limit?: number
  min_score?: number
  tags?: string[]
  session_id?: string
}

export interface McbMemoryStoreParams {
  action: "store"
  resource: "observation" | "execution" | "quality_gate" | "error_pattern" | "session"
  data: Record<string, unknown>
  session_id?: string
  tags?: string[]
  project_id?: string
}

export interface McbIndexParams {
  action: "start" | "status" | "clear"
  path: string
  collection: string
  extensions?: string[]
  exclude_dirs?: string[]
}

export interface McbValidateParams {
  action: "run" | "list_rules" | "analyze"
  scope: "file" | "project"
  path: string
  rules?: string[]
  category?: string
}

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
