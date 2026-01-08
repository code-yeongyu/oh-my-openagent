/**
 * Antigravity Auth Type Definitions
 * Matches cliproxyapi/sdk/auth/antigravity.go token format exactly
 */

/**
 * Token storage format for Antigravity authentication
 * Matches Go metadata structure: type, access_token, refresh_token, expires_in, timestamp, email, project_id
 */
export interface AntigravityTokens {
  /** Always "antigravity" for this auth type */
  type: "antigravity"
  /** OAuth access token from Google */
  access_token: string
  /** OAuth refresh token from Google */
  refresh_token: string
  /** Token expiration time in seconds */
  expires_in: number
  /** Unix timestamp in milliseconds when tokens were obtained */
  timestamp: number
  /** ISO 8601 formatted expiration datetime (optional, for display) */
  expired?: string
  /** User's email address from Google userinfo */
  email?: string
  /** GCP project ID from loadCodeAssist API */
  project_id?: string
}

/**
 * Project context returned from loadCodeAssist API
 * Used to get cloudaicompanionProject for API calls
 */
export interface AntigravityProjectContext {
  /** GCP project ID for Cloud AI Companion */
  cloudaicompanionProject?: string
  /** Managed project ID for enterprise users (optional) */
  managedProjectId?: string
}

/**
 * Metadata for loadCodeAssist API request
 */
export interface AntigravityClientMetadata {
  /** IDE type identifier */
  ideType: "IDE_UNSPECIFIED" | string
  /** Platform identifier */
  platform: "PLATFORM_UNSPECIFIED" | string
  /** Plugin type - typically "GEMINI" */
  pluginType: "GEMINI" | string
}

/**
 * Request body for loadCodeAssist API
 */
export interface AntigravityLoadCodeAssistRequest {
  metadata: AntigravityClientMetadata
}

export interface AntigravityUserTier {
  id?: string
  isDefault?: boolean
  userDefinedCloudaicompanionProject?: boolean
}

export interface AntigravityLoadCodeAssistResponse {
  cloudaicompanionProject?: string | { id: string }
  currentTier?: { id?: string }
  allowedTiers?: AntigravityUserTier[]
}

export interface AntigravityOnboardUserPayload {
  done?: boolean
  response?: {
    cloudaicompanionProject?: { id?: string }
  }
}

/**
 * Request body format for Antigravity API calls
 * Wraps the actual request with project and model context
 */
export interface AntigravityRequestBody {
  project: string
  model: string
  userAgent: string
  requestType: string
  requestId: string
  request: Record<string, unknown>
}

/**
 * Response format from Antigravity API
 * Follows OpenAI-compatible structure with Gemini extensions
 */
export interface AntigravityResponse {
  /** Response ID */
  id?: string
  /** Object type (e.g., "chat.completion") */
  object?: string
  /** Creation timestamp */
  created?: number
  /** Model used for response */
  model?: string
  /** Response choices */
  choices?: AntigravityResponseChoice[]
  /** Token usage statistics */
  usage?: AntigravityUsage
  /** Error information if request failed */
  error?: AntigravityError
}

/**
 * Single response choice in Antigravity response
 */
export interface AntigravityResponseChoice {
  /** Choice index */
  index: number
  /** Message content */
  message?: {
    role: "assistant"
    content?: string
    tool_calls?: AntigravityToolCall[]
  }
  /** Delta for streaming responses */
  delta?: {
    role?: "assistant"
    content?: string
    tool_calls?: AntigravityToolCall[]
  }
  /** Finish reason */
  finish_reason?: "stop" | "tool_calls" | "length" | "content_filter" | null
}

/**
 * Tool call in Antigravity response
 */
export interface AntigravityToolCall {
  id: string
  type: "function"
  function: {
    name: string
    arguments: string
  }
}

/**
 * Token usage statistics
 */
export interface AntigravityUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
}

/**
 * Error response from Antigravity API
 */
export interface AntigravityError {
  message: string
  type?: string
  code?: string | number
}

/**
 * Token exchange result from Google OAuth
 * Matches antigravityTokenResponse in Go
 */
export interface AntigravityTokenExchangeResult {
  access_token: string
  refresh_token: string
  expires_in: number
  token_type: string
}

/**
 * User info from Google userinfo API
 */
export interface AntigravityUserInfo {
  email: string
  name?: string
  picture?: string
}

/**
 * Parsed refresh token parts
 * Format: refreshToken|projectId|managedProjectId
 */
export interface AntigravityRefreshParts {
  refreshToken: string
  projectId?: string
  managedProjectId?: string
}

/**
 * OAuth error payload from Google
 * Google returns errors in multiple formats, this handles all of them
 */
export interface OAuthErrorPayload {
  error?: string | { status?: string; code?: string; message?: string }
  error_description?: string
}

/**
 * Parsed OAuth error with normalized fields
 */
export interface ParsedOAuthError {
  code?: string
  description?: string
}

/**
 * Multi-account support types
 */

/** All model families for rate limit tracking */
export const MODEL_FAMILIES = ["claude", "gemini-flash", "gemini-pro"] as const

/** Model family for rate limit tracking */
export type ModelFamily = (typeof MODEL_FAMILIES)[number]

/** Account tier for prioritization */
export type AccountTier = "free" | "paid"

/** Rate limit state per model family (Unix timestamps in ms) */
export type RateLimitState = Partial<Record<ModelFamily, number>>

/** Account metadata for storage */
export interface AccountMetadata {
  email: string
  tier: AccountTier
  refreshToken: string
  projectId: string
  managedProjectId?: string
  accessToken: string
  expiresAt: number
  rateLimits: RateLimitState
}

/** Storage schema for persisting multiple accounts */
export interface AccountStorage {
  version: number
  accounts: AccountMetadata[]
  activeIndex: number
}
