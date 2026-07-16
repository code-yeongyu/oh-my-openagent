import type {
  OpenVikingClientConfig,
  RecallRequest,
  RecallResponse,
  CommitRequest,
  CommitResponse,
  HealthResponse,
  Memory,
  Session,
} from "./types"
import {
  OpenVikingError,
  OpenVikingNetworkError,
  OpenVikingTimeoutError,
} from "./types"
import type { MemoryType } from "../../config/schema/openviking"

/**
 * Fetch function type for dependency injection
 */
export type FetchFn = typeof fetch

/**
 * Default timeout values (ms)
 */
const TIMEOUTS = {
  HEALTH: 5000,
  RECALL: 2000,
  COMMIT: 10000,
} as const

/**
 * Default configuration
 */
const DEFAULT_CONFIG: Required<OpenVikingClientConfig> = {
  url: "http://localhost:1933",
  api_key: "",
  timeout_ms: 5000,
  max_retries: 0,
}

/**
 * OpenViking client for interacting with OpenViking Server
 * 
 * Provides methods for:
 * - Health checking
 * - Memory recall
 * - Session commit
 * 
 * Uses dependency injection for fetch to enable testing
 */
export class OpenVikingClient {
  private readonly config: Required<OpenVikingClientConfig>
  private readonly baseUrl: string
  private readonly fetchFn: FetchFn

  constructor(config: OpenVikingClientConfig, fetchFn: FetchFn = fetch) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.baseUrl = this.config.url.replace(/\/$/, "") // Remove trailing slash
    this.fetchFn = fetchFn
  }

  /**
   * Check OpenViking server health
   * 
   * @returns Health status
   * @throws OpenVikingNetworkError if server is unreachable
   * @throws OpenVikingTimeoutError if request times out
   */
  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>({
      method: "GET",
      path: "/health",
      timeout_ms: TIMEOUTS.HEALTH,
    })
  }

  /**
   * Recall relevant memories based on query
   * 
   * @param query - Query text to search for
   * @param types - Memory types to filter by (optional)
   * @param limit - Maximum number of memories to return (default: 5)
   * @returns Recalled memories
   * @throws OpenVikingNetworkError if server is unreachable
   * @throws OpenVikingTimeoutError if request times out (2s)
   */
  async recall(
    query: string,
    types?: MemoryType[],
    limit: number = 5
  ): Promise<RecallResponse> {
    const request: RecallRequest = {
      query,
      types,
      limit,
    }

    return this.request<RecallResponse>({
      method: "POST",
      path: "/api/v1/memories/recall",
      body: request,
      timeout_ms: TIMEOUTS.RECALL,
    })
  }

  /**
   * Commit session to OpenViking for memory extraction
   * 
   * @param session - Session to commit
   * @param extractMemories - Whether to extract memories (default: true)
   * @param generateSummaries - Whether to generate L0/L1 summaries (default: true)
   * @returns Commit response with task ID for async processing
   * @throws OpenVikingNetworkError if server is unreachable
   * @throws OpenVikingTimeoutError if request times out (10s)
   */
  async commit(
    session: Session,
    extractMemories: boolean = true,
    generateSummaries: boolean = true
  ): Promise<CommitResponse> {
    const request: CommitRequest = {
      session,
      extract_memories: extractMemories,
      generate_summaries: generateSummaries,
    }

    return this.request<CommitResponse>({
      method: "POST",
      path: "/api/v1/sessions/commit",
      body: request,
      timeout_ms: TIMEOUTS.COMMIT,
    })
  }

  /**
   * Make HTTP request to OpenViking server
   * 
   * @param options - Request options
   * @returns Response data
   * @throws OpenVikingError on API errors
   * @throws OpenVikingNetworkError on network errors
   * @throws OpenVikingTimeoutError on timeout
   */
  private async request<T>(options: {
    method: "GET" | "POST" | "PUT" | "DELETE"
    path: string
    body?: unknown
    timeout_ms: number
  }): Promise<T> {
    const url = `${this.baseUrl}${options.path}`
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    }

    // Add API key if configured
    if (this.config.api_key) {
      headers["Authorization"] = `Bearer ${this.config.api_key}`
    }

    // Create abort controller for timeout
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), options.timeout_ms)

    try {
      const response = await this.fetchFn(url, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      // Handle HTTP errors
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}: ${response.statusText}`
        let errorDetails: unknown

        try {
          const errorBody = await response.json()
          if (errorBody.error) {
            errorMessage = errorBody.error
          }
          errorDetails = errorBody
        } catch {
          // Ignore JSON parsing errors
        }

        throw new OpenVikingError(
          errorMessage,
          response.status,
          undefined,
          errorDetails
        )
      }

      // Parse response
      const data = await response.json()
      return data as T
    } catch (error) {
      clearTimeout(timeoutId)

      // Handle timeout
      if (error instanceof Error && error.name === "AbortError") {
        throw new OpenVikingTimeoutError(
          `Request timed out after ${options.timeout_ms}ms`,
          options.timeout_ms
        )
      }

      // Handle network errors
      if (error instanceof TypeError) {
        throw new OpenVikingNetworkError(
          `Network error: ${error.message}`,
          error
        )
      }

      // Re-throw OpenViking errors
      if (error instanceof OpenVikingError) {
        throw error
      }

      // Wrap unknown errors
      throw new OpenVikingError(
        `Unknown error: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get server URL
   */
  getUrl(): string {
    return this.baseUrl
  }

  /**
   * Check if client is configured with API key
   */
  hasApiKey(): boolean {
    return Boolean(this.config.api_key)
  }
}

/**
 * Create OpenViking client from configuration
 * 
 * @param config - Client configuration
 * @returns OpenViking client instance
 */
export function createOpenVikingClient(
  config: OpenVikingClientConfig
): OpenVikingClient {
  return new OpenVikingClient(config)
}
