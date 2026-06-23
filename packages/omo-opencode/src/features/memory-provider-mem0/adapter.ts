import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type { CanonicalMemory, SyncState } from "../memory-core/types"
import type {
  L2FilterNode,
  L2HistoryEntry,
  L2Provider,
  L2SearchOptions,
  L2SearchResult,
  L2StoredMemory,
  ProviderCapabilityFlags,
} from "../memory-provider-core/types"
import { buildMem0SearchRequest, canonicalToMem0AddRequest, mem0ToL2SearchResult } from "./mapper"
import { RETRIEVAL_PRESETS } from "./advanced-retrieval"
import { loadMem0Client } from "./client-loader"
import { buildSafeFilter } from "./filter-dsl"
import { DEFAULT_GRAPH_CONFIG, extractGraphData } from "./graph-memory"
import { readMem0History } from "./mem0-history-reader"
import { pollForCreatedMem0Memory } from "./mem0-created-memory-poller"
import { retryMem0NotFound } from "./mem0-not-found-retry"
import { readScopedMem0Memory } from "./mem0-scoped-memory-reader"
import { isMem0ScopeError } from "./mem0-scope-guard"
import { Mem0RateLimiter } from "./rate-limiter"
import {
  extractSearchMemories,
  isNotFoundError,
  pickFirstAddResult,
} from "./response-helpers"
import type {
  Mem0Client,
  Mem0ClientConfig,
  Mem0Memory,
} from "./types"
import { buildCanonicalMemoryFromWorkItem } from "./work-item-canonical-memory"

export interface Mem0L2AdapterConfig {
  clientConfig: Mem0ClientConfig
  projectId: string
  defaultUserId?: string
}

export class Mem0L2Adapter implements L2Provider {
  readonly providerName = "mem0"

  readonly capabilities: ProviderCapabilityFlags = {
    update: true,
    delete: true,
    rich_filters: true,
    history: true,
    graph: true,
    batch: true,
    webhooks: true,
    export: true,
    async_client: true,
  }

  private client: Mem0Client | undefined = undefined
  private readonly rateLimiter: Mem0RateLimiter

  constructor(private readonly config: Mem0L2AdapterConfig) {
    this.rateLimiter = new Mem0RateLimiter({
      maxRetries: 3,
      initialBackoffMs: 1000,
      maxBackoffMs: 32000,
      jitterFactor: 0.3,
    })
  }

  async isAvailable(): Promise<boolean> { return Boolean(this.config.clientConfig.apiKey) }

  async index(memory: CanonicalMemory): Promise<string> {
    return this.rateLimiter.executeWithRetry(async () => {
      const client = await this.getClient()
      const request = canonicalToMem0AddRequest(memory)
      const result = await client.add(request.messages, {
        user_id: request.user_id,
        run_id: request.run_id,
        metadata: request.metadata,
        infer: request.infer,
        enable_graph: true,
      })
      const firstResult = pickFirstAddResult(result as { id?: string } | { id?: string }[])

      if (firstResult && typeof firstResult === "object" && typeof firstResult.id === "string") {
        return firstResult.id
      }

      const effectiveUserId = request.user_id ?? `${this.config.projectId}:system`
      return pollForCreatedMem0Memory(client, effectiveUserId)
    }, "index")
  }

  async indexWorkItem(workItem: MemoryWorkItem): Promise<string> {
    return this.index(buildCanonicalMemoryFromWorkItem(workItem, this.providerName))
  }

  async search(query: string, options?: L2SearchOptions): Promise<L2SearchResult[]> {
    return this.rateLimiter.executeWithRetry(async () => {
      const client = await this.getClient()
      const request = buildMem0SearchRequest(
        query,
        this.config.projectId,
        this.config.defaultUserId,
        options,
      )
      const retrievalPreset =
        options?.rerank === undefined
          ? RETRIEVAL_PRESETS.balanced
          : {
              rerank: options.rerank ?? false,
              keyword_search: options.keyword_search ?? false,
              filter_memories: options.filter_memories ?? false,
            }
      const filters = buildSafeFilter(
        request.user_id ?? `${this.config.projectId}:system`,
        options?.filters as L2FilterNode | undefined,
      )

      const result = await (
        client as { search(query: string, options: unknown): Promise<unknown> }
      ).search(request.query, {
        user_id: request.user_id,
        top_k: request.top_k,
        threshold: request.threshold,
        rerank: retrievalPreset.rerank,
        keyword_search: retrievalPreset.keyword_search,
        filter_memories: retrievalPreset.filter_memories,
        filters,
        enable_graph: DEFAULT_GRAPH_CONFIG.enabled,
      })

      if (DEFAULT_GRAPH_CONFIG.enabled) {
        void extractGraphData(Array.isArray(result) ? result[0] : result)
      }

      return extractSearchMemories(result as { results?: Mem0Memory[] } | Mem0Memory[])
        .map(memory => mem0ToL2SearchResult(memory))
    }, "search")
  }

  async getById(providerExternalId: string): Promise<L2StoredMemory | undefined> {
    try {
      const result = await this.readScopedMemory(providerExternalId, "getById")
      return { provider_external_id: result.id, content: result.memory, metadata: result.metadata, created_at: result.created_at, updated_at: result.updated_at }
    } catch (error) {
      if (isNotFoundError(error) || isMem0ScopeError(error)) {
        return undefined
      }

      throw error
    }
  }

  async update(providerExternalId: string, memory: Partial<CanonicalMemory>): Promise<void> {
    await this.readScopedMemory(providerExternalId, "update")
    await retryMem0NotFound(this.rateLimiter, async () => {
      const client = await this.getClient()
      const content = memory.summary ?? memory.title ?? ""
      const metadata: Record<string, unknown> = {
        memory_id: memory.memory_id,
        project_id: memory.project_id,
      }
      await client.update(providerExternalId, content, metadata)
    }, "update")
  }

  async delete(providerExternalId: string): Promise<void> {
    await this.readScopedMemory(providerExternalId, "delete")
    await retryMem0NotFound(this.rateLimiter, async () => {
      const client = await this.getClient()
      await client.delete(providerExternalId)
    }, "delete")
  }

  async getHistory(providerExternalId: string): Promise<L2HistoryEntry[]> {
    try {
      await this.readScopedMemory(providerExternalId, "getHistory")
    } catch (error) {
      if (isNotFoundError(error) || isMem0ScopeError(error)) {
        return []
      }

      throw error
    }

    return this.rateLimiter.executeWithRetry(async () => {
      const client = await this.getClient()
      return readMem0History(client, providerExternalId)
    }, "getHistory")
  }

  async batchDelete(ids: string[]): Promise<void> {
    for (const id of ids) {
      await this.readScopedMemory(id, "batchDelete")
    }

    await this.rateLimiter.executeWithRetry(async () => {
      const client = await this.getClient()
      await client.batchDelete(ids)
    }, "batchDelete")
  }

  async getSyncState(_memoryId: string): Promise<SyncState | undefined> { return undefined }

  async updateSyncState(_state: SyncState): Promise<void> {}

  private async getClient(): Promise<Mem0Client> {
    if (this.client) return this.client
    this.client = await loadMem0Client(this.config.clientConfig)
    return this.client
  }

  private async readScopedMemory(providerExternalId: string, opName: string) {
    return readScopedMem0Memory({
      providerExternalId,
      opName,
      getClient: () => this.getClient(),
      rateLimiter: this.rateLimiter,
      scope: this.config,
    })
  }
}
