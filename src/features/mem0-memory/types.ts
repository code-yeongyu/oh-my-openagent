export type MemoryLayer =
  | "user"
  | "session"
  | "project"
  | "org"
  | "company"

export interface Memory {
  id: string
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
  createdAt: string
  updatedAt?: string
}

export interface MemorySearchResult {
  memory: Memory
  score: number
}

export interface AddMemoryInput {
  content: string
  layer: MemoryLayer
  metadata?: Record<string, unknown>
}

export interface SearchMemoryInput {
  query: string
  layer?: MemoryLayer | MemoryLayer[]
  limit?: number
  threshold?: number
}

export interface UpdateMemoryInput {
  id: string
  content?: string
  metadata?: Record<string, unknown>
}

export interface DeleteMemoryInput {
  id: string
}

export interface Mem0Config {
  enabled: boolean
  apiKey?: string
  endpoint?: string
  userId?: string
  projectId?: string
  orgId?: string
  companyId?: string
}

export interface MemoryStats {
  totalMemories: number
  byLayer: Record<MemoryLayer, number>
}
