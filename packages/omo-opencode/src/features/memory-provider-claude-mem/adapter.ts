import type { MemoryWorkItem } from "../claude-tasks/memory-work-item"
import type {
  L1PromotionCandidateOptions,
  L1Provider,
  L1SearchOptions,
  L1SearchResult,
  L1SessionContext,
  ProviderCapabilityFlags,
} from "../memory-provider-core/types"
import type { PromotionCandidate } from "../memory-core/types"
import { ClaudeMemHttpClient } from "./http-client"
import { ClaudeMemSQLiteReader } from "./sqlite-reader"
import { buildSessionContext } from "./session-resume"
import { extractPromotionCandidates } from "./promotion-export"
import type { ClaudeMemAddObservationRequest, ClaudeMemWorkerConfig, LostWriteRow } from "./types"

const DEFAULT_MAX_SEARCH_RETRIES = 2
const DEFAULT_DEDUP_SET_MAX_SIZE = 100

export interface ClaudeMemL1AdapterConfig {
  workerConfig?: Partial<ClaudeMemWorkerConfig>
  sqliteDbPath?: string
  maxSearchRetries?: number
  searchFallbackEnabled?: boolean
  dedupSetMaxSize?: number
}

export class ClaudeMemL1Adapter implements L1Provider {
  readonly providerName = "claude-mem"

  readonly capabilities: ProviderCapabilityFlags = {
    update: false,
    delete: false,
    rich_filters: false,
    history: false,
    graph: false,
    batch: false,
    webhooks: false,
    export: false,
    async_client: false,
  }

  private readonly httpClient: ClaudeMemHttpClient
  private readonly sqliteReader: ClaudeMemSQLiteReader
  private readonly maxSearchRetries: number
  private readonly searchFallbackEnabled: boolean
  private readonly dedupSetMaxSize: number
  private readonly recentEventIds = new Set<string>()

  constructor(config: ClaudeMemL1AdapterConfig = {}) {
    this.httpClient = new ClaudeMemHttpClient(config.workerConfig ?? {})
    this.sqliteReader = new ClaudeMemSQLiteReader(
      config.sqliteDbPath ? { dbPath: config.sqliteDbPath } : {},
    )
    this.maxSearchRetries = config.maxSearchRetries ?? DEFAULT_MAX_SEARCH_RETRIES
    this.searchFallbackEnabled = config.searchFallbackEnabled ?? true
    this.dedupSetMaxSize = config.dedupSetMaxSize ?? DEFAULT_DEDUP_SET_MAX_SIZE
    // Gotcha #859: adapter is read-only and never writes to CLAUDE.md.
    // Gotcha #29175: adapter stays at session granularity, never individual tool-output stitching.
  }

  async isAvailable(): Promise<boolean> {
    // Gotcha #1296: trust PID liveness instead of assuming an open port means a healthy worker.
    const processAlive = await this.httpClient.isWorkerProcessAlive()
    if (!processAlive) return false

    try {
      const health = await this.httpClient.health()
      return health.status === "ok"
    } catch {
      // Gotcha #1707: a hung Stop path can leave the worker unhealthy; SQLite keeps read access alive.
      return this.sqliteReader.isAvailable()
    }
  }

  async search(query: string, options: L1SearchOptions = {}): Promise<L1SearchResult[]> {
    // Gotcha #1713: only the FTS5 worker endpoint is used because ClaudeMemHttpClient.search() only hits /api/search.
    for (let attempt = 0; attempt < this.maxSearchRetries; attempt += 1) {
      try {
        const processAlive = await this.httpClient.isWorkerProcessAlive()
        if (!processAlive) break

        const response = await this.httpClient.search({
          q: query,
          limit: options.limit,
          project: options.project,
          type: options.type,
          obs_type: options.obs_type,
          date_start: options.date_start,
          date_end: options.date_end,
        })

        return response.results.map(mapSearchResult)
      } catch {
        // Gotcha #870: bounded retries avoid amplifying hung worker loops; the client timeout aborts each attempt.
        if (attempt + 1 >= this.maxSearchRetries) break
        await Bun.sleep(500 * (attempt + 1))
      }
    }

    // Gotcha #1707: SQLite is the defensive read fallback when the HTTP worker is gone or stuck.
    if (this.searchFallbackEnabled && this.sqliteReader.isAvailable()) {
      return this.sqliteReader
        .searchObservations(query, {
          project: options.project,
          obs_type: options.obs_type,
          limit: options.limit,
          date_start: options.date_start,
        })
        .map(mapSearchResult)
    }

    return []
  }

  getSessionContext(sessionId: string): Promise<L1SessionContext | undefined> {
    // Gotcha #1707: buildSessionContext already prefers worker data and falls back to SQLite session recovery.
    return buildSessionContext(sessionId, {
      sqliteReader: this.sqliteReader,
      httpClient: this.httpClient,
    })
  }

  async getPromotionCandidates(
    options?: L1PromotionCandidateOptions,
  ): Promise<PromotionCandidate[]> {
    if (!this.sqliteReader.isAvailable()) return []

    // Gotcha #711: failed pending_messages are exposed separately via getLostWrites instead of being promoted.
    return extractPromotionCandidates(this.sqliteReader, options)
  }

  isDuplicateEvent(eventId: string): boolean {
    // Gotcha #24115: duplicate hook fires are deduped with a bounded FIFO-ish set.
    if (this.recentEventIds.has(eventId)) return true

    if (this.recentEventIds.size >= this.dedupSetMaxSize) {
      const oldest = this.recentEventIds.values().next().value
      if (oldest !== undefined) this.recentEventIds.delete(oldest)
    }

    this.recentEventIds.add(eventId)
    return false
  }

  getLostWrites(contentSessionId: string): LostWriteRow[] {
    // Gotcha #711: orphaned writes are surfaced as diagnostics only and never converted into promotion candidates.
    if (!this.sqliteReader.isAvailable()) return []
    return this.sqliteReader.getLostWrites(contentSessionId)
  }

  async writeWorkItem(workItem: MemoryWorkItem): Promise<void> {
    await this.httpClient.addObservation(buildObservationRequest(workItem))
  }

  dispose(): void {
    this.sqliteReader.close()
    this.recentEventIds.clear()
  }
}

function mapSearchResult(result: {
  id: number
  title: string
  subtitle?: string
  project: string
  time: string
}): L1SearchResult {
  return {
    id: String(result.id),
    title: result.title,
    subtitle: result.subtitle,
    source: result.project,
    created_at: result.time,
  }
}

function buildObservationRequest(workItem: MemoryWorkItem): ClaudeMemAddObservationRequest {
  return {
    session_id: workItem.contentSessionId,
    tool_name: getPayloadString(workItem.payload, ["tool_name", "toolName"]) ?? workItem.source,
    tool_input: getToolInput(workItem.payload),
    tool_response:
      getPayloadString(workItem.payload, ["tool_response", "summary", "content", "text", "fact", "preference", "output"])
      ?? JSON.stringify(workItem.payload),
    cwd: getPayloadString(workItem.payload, ["cwd"]),
  }
}

function getToolInput(payload: Record<string, unknown>): Record<string, unknown> | undefined {
  const toolInput = payload.tool_input ?? payload.toolInput
  const metadata = payload.metadata

  if (toolInput && typeof toolInput === "object" && !Array.isArray(toolInput)) {
    return metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? {
          ...(toolInput as Record<string, unknown>),
          metadata,
        }
      : toolInput as Record<string, unknown>
  }

  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { metadata }
  }

  return undefined
}

function getPayloadString(payload: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = payload[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }

  return undefined
}
