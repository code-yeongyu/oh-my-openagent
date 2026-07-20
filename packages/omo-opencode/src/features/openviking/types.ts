import type { MemoryType } from "../../config/schema/openviking"

/**
 * Memory representation from OpenViking
 */
export interface Memory {
  /** Unique identifier for the memory */
  id: string
  
  /** Memory content */
  content: string
  
  /** Memory type/category */
  type: MemoryType
  
  /** Relevance score (0-1) */
  score: number
  
  /** Source session ID (if applicable) */
  source_session_id?: string
  
  /** Creation timestamp */
  created_at: string
  
  /** Last updated timestamp */
  updated_at: string
  
  /** Optional metadata */
  metadata?: Record<string, unknown>
}

/**
 * Session representation for OpenViking
 */
export interface Session {
  /** Unique session identifier */
  id: string
  
  /** Session messages */
  messages: SessionMessage[]
  
  /** Session metadata */
  metadata?: SessionMetadata
  
  /** Creation timestamp */
  created_at: string
  
  /** End timestamp (if session ended) */
  ended_at?: string
}

/**
 * Session message representation
 */
export interface SessionMessage {
  /** Message role */
  role: "user" | "assistant" | "system" | "tool"
  
  /** Message content */
  content: string
  
  /** Message timestamp */
  timestamp: string
  
  /** Tool call information (if role is "tool") */
  tool_call?: ToolCall
  
  /** Tool result information (if role is "tool") */
  tool_result?: ToolResult
}

/**
 * Tool call information
 */
export interface ToolCall {
  /** Tool name */
  name: string
  
  /** Tool arguments */
  arguments: Record<string, unknown>
  
  /** Tool call ID */
  id: string
}

/**
 * Tool result information
 */
export interface ToolResult {
  /** Tool call ID this result corresponds to */
  tool_call_id: string
  
  /** Tool result content */
  content: string
  
  /** Whether the tool call was successful */
  success: boolean
}

/**
 * Session metadata
 */
export interface SessionMetadata {
  /** Project directory */
  project_directory?: string
  
  /** Agent name */
  agent?: string
  
  /** Model used */
  model?: string
  
  /** Total tokens consumed */
  total_tokens?: number
  
  /** Custom metadata */
  [key: string]: unknown
}

/**
 * Memory recall request
 */
export interface RecallRequest {
  /** Query text to search for */
  query: string
  
  /** Memory types to filter by */
  types?: MemoryType[]
  
  /** Maximum number of memories to return */
  limit?: number
  
  /** Minimum relevance score (0-1) */
  min_score?: number
}

/**
 * Memory recall response
 */
export interface RecallResponse {
  /** List of recalled memories */
  memories: Memory[]
  
  /** Total number of memories found */
  total: number
  
  /** Query used for recall */
  query: string
  
  /** Time taken for recall (ms) */
  duration_ms: number
}

/**
 * Session commit request
 */
export interface CommitRequest {
  /** Session to commit */
  session: Session
  
  /** Whether to extract memories (async) */
  extract_memories?: boolean
  
  /** Whether to generate L0/L1 summaries (async) */
  generate_summaries?: boolean
}

/**
 * Session commit response
 */
export interface CommitResponse {
  /** Whether commit was successful */
  success: boolean
  
  /** Committed session ID */
  session_id: string
  
  /** Task ID for async processing */
  task_id?: string
  
  /** Number of memories extracted */
  memories_extracted?: number
  
  /** Error message (if failed) */
  error?: string
}

/**
 * Health check response
 */
export interface HealthResponse {
  /** Server status */
  status: "healthy" | "unhealthy" | "degraded"
  
  /** Server version */
  version: string
  
  /** Server uptime (seconds) */
  uptime_seconds: number
  
  /** Available memory count */
  memory_count: number
  
  /** Available session count */
  session_count: number
}

/**
 * OpenViking client configuration
 */
export interface OpenVikingClientConfig {
  /** Server URL */
  url: string
  
  /** API key (optional) */
  api_key?: string
  
  /** Request timeout (ms) */
  timeout_ms?: number
  
  /** Maximum retry attempts */
  max_retries?: number
}

/**
 * OpenViking API error
 */
export class OpenVikingError extends Error {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly code?: string,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = "OpenVikingError"
  }
}

/**
 * Network error (connection refused, timeout, etc.)
 */
export class OpenVikingNetworkError extends OpenVikingError {
  constructor(message: string, public readonly cause?: Error) {
    super(message, undefined, "NETWORK_ERROR")
    this.name = "OpenVikingNetworkError"
  }
}

/**
 * Timeout error
 */
export class OpenVikingTimeoutError extends OpenVikingError {
  constructor(
    message: string,
    public readonly timeout_ms: number
  ) {
    super(message, undefined, "TIMEOUT_ERROR")
    this.name = "OpenVikingTimeoutError"
  }
}
