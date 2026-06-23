import type { CanonicalMemory, PromotionCandidate, SyncState } from "../memory-core/types"

export interface ProviderCapabilityFlags {
  update: boolean
  delete: boolean
  rich_filters: boolean
  history: boolean
  graph: boolean
  batch: boolean
  webhooks: boolean
  export: boolean
  async_client: boolean
}

export interface L1Provider {
  readonly capabilities: ProviderCapabilityFlags
  readonly providerName: string

  isAvailable(): Promise<boolean>
  search(query: string, options?: L1SearchOptions): Promise<L1SearchResult[]>
  getSessionContext(sessionId: string): Promise<L1SessionContext | undefined>
  getPromotionCandidates(options?: L1PromotionCandidateOptions): Promise<PromotionCandidate[]>
}

export interface L1SearchOptions {
  project?: string
  limit?: number
  type?: "observations" | "sessions" | "prompts"
  obs_type?: string
  date_start?: string
  date_end?: string
}

export interface L1SearchResult {
  id: string
  title: string
  subtitle?: string
  score?: number
  source: string
  created_at: string
}

export interface L1SessionContext {
  session_id: string
  project: string
  summary?: string
  observations: L1SearchResult[]
  started_at: string
  completed_at?: string
}

export interface L1PromotionCandidateOptions {
  project?: string
  min_discovery_tokens?: number
  limit?: number
  since?: string
}

export interface L2Provider {
  readonly capabilities: ProviderCapabilityFlags
  readonly providerName: string

  isAvailable(): Promise<boolean>
  index(memory: CanonicalMemory): Promise<string>
  search(query: string, options?: L2SearchOptions): Promise<L2SearchResult[]>
  getById(provider_external_id: string): Promise<L2StoredMemory | undefined>
  update?(provider_external_id: string, memory: Partial<CanonicalMemory>): Promise<void>
  delete?(provider_external_id: string): Promise<void>
  getHistory?(provider_external_id: string): Promise<L2HistoryEntry[]>
  batchDelete?(ids: string[]): Promise<void>
  getSyncState(memory_id: string): Promise<SyncState | undefined>
  updateSyncState(state: SyncState): Promise<void>
}

export interface L2SearchOptions {
  project_id?: string
  user_id?: string
  agent_id?: string
  run_id?: string
  limit?: number
  threshold?: number
  rerank?: boolean
  keyword_search?: boolean
  filter_memories?: boolean
  filters?: L2FilterNode
}

export type L2FilterOperator = "eq" | "ne" | "gt" | "gte" | "lt" | "lte" | "in" | "nin" | "contains"

export interface L2FilterLeaf {
  field: string
  operator: L2FilterOperator
  value: string | number | string[]
}

export interface L2FilterNode {
  AND?: Array<L2FilterLeaf | L2FilterNode>
  OR?: Array<L2FilterLeaf | L2FilterNode>
  NOT?: L2FilterLeaf | L2FilterNode
  field?: string
  value?: string | number | string[]
}

export interface L2SearchResult {
  provider_external_id: string
  memory_id?: string
  content: string
  score: number
  metadata?: Record<string, unknown>
}

export interface L2StoredMemory {
  provider_external_id: string
  content: string
  metadata?: Record<string, unknown>
  created_at?: string
  updated_at?: string
}

export interface L2HistoryEntry {
  provider_external_id: string
  previous_value: string
  new_value: string
  action: "ADD" | "UPDATE" | "DELETE"
  changed_at: string
}

export function assertCapability(
  provider: L1Provider | L2Provider,
  cap: keyof ProviderCapabilityFlags,
  operationName: string,
): void {
  if (!provider.capabilities[cap]) {
    throw new ProviderCapabilityError(provider.providerName, cap, operationName)
  }
}

export class ProviderCapabilityError extends Error {
  constructor(
    public readonly providerName: string,
    public readonly requiredCapability: keyof ProviderCapabilityFlags,
    public readonly operationName: string,
  ) {
    super(`Provider "${providerName}" does not support capability "${requiredCapability}" required for "${operationName}"`)
    this.name = "ProviderCapabilityError"
  }
}
