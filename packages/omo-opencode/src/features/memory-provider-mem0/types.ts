// ANTI-LOCK-IN: Mem0 types MUST NOT leak into the canonical domain model.
// The mapper is the only legal boundary crossing.

export interface Mem0Memory {
  id: string
  memory: string
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  categories?: string[]
  created_at?: string
  updated_at?: string
  score?: number
  metadata?: Record<string, unknown>
}

export interface Mem0SearchFilter {
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  categories?: string
  created_at?: { gte?: string; lte?: string }
  [key: string]: unknown
}

export interface Mem0Message {
  role: "user" | "assistant"
  content: string
}

export interface Mem0AddRequest {
  messages: Mem0Message[]
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  metadata?: Record<string, unknown>
  infer?: boolean
  async_mode?: boolean
  enable_graph?: boolean
}

export interface Mem0SearchRequest {
  query: string
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  top_k?: number
  threshold?: number
  rerank?: boolean
  keyword_search?: boolean
  filter_memories?: boolean
  enable_graph?: boolean
  filters?: Record<string, unknown>
}

export interface Mem0HistoryEntry {
  memory_id: string
  previous_value?: string
  new_value: string
  action: "ADD" | "UPDATE" | "DELETE"
  created_at: string
}

export interface Mem0ClientConfig {
  apiKey: string
  organizationId?: string
  projectId?: string
  baseUrl?: string
}

export interface Mem0AddOptions {
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  metadata?: Record<string, unknown>
  infer?: boolean
  async_mode?: boolean
  enable_graph?: boolean
}

export interface Mem0SearchOptions {
  user_id?: string
  agent_id?: string
  app_id?: string
  run_id?: string
  top_k?: number
  threshold?: number
  rerank?: boolean
  keyword_search?: boolean
  filter_memories?: boolean
  enable_graph?: boolean
}

export interface Mem0AddResultEntry {
  id?: string
  event_id?: string
  event?: "ADD" | "UPDATE" | "DELETE" | "NONE"
  data?: { memory?: string }
}

export interface Mem0EventResult {
  event_id: string
  status: "PENDING" | "DONE" | "FAILED"
  memory_id?: string
  error?: string
}

export interface Mem0SearchResultEnvelope {
  results?: Mem0Memory[]
}

export interface Mem0HistoryRawEntry {
  previous_value?: string
  new_value?: string
  event?: "ADD" | "UPDATE" | "DELETE"
  created_at?: string
}

export interface Mem0Client {
  add(
    messagesOrText: Mem0Message[] | string,
    options: Mem0AddOptions,
  ): Promise<Mem0AddResultEntry[] | Mem0AddResultEntry>
  getEvent?(eventId: string): Promise<Mem0EventResult>
  search(
    query: string,
    options: Mem0SearchOptions,
  ): Promise<Mem0SearchResultEnvelope | Mem0Memory[]>
  get(memoryId: string): Promise<Mem0Memory | undefined>
  update(
    memoryId: string,
    content: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>
  delete(memoryId: string): Promise<void>
  history(memoryId: string): Promise<Mem0HistoryRawEntry[]>
  batchDelete(ids: string[]): Promise<void>
  getAll(options: { user_id: string; limit?: number; page?: number; page_size?: number }): Promise<Mem0Memory[]>
}
