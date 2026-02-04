/**
 * Runtime Fallback Hook - Type Definitions
 *
 * Types for managing runtime model fallback when API errors occur.
 */

import type { RuntimeFallbackConfig, OhMyOpenCodeConfig } from "../../config"

/**
 * Tracks the state of fallback attempts for a session
 */
export interface FallbackState {
  originalModel: string
  currentModel: string
  fallbackIndex: number
  failedModels: Map<string, number>
  attemptCount: number
  pendingFallbackModel?: string
}

/**
 * Error information extracted from session.error event
 */
export interface SessionErrorInfo {
  /** Session ID that encountered the error */
  sessionID: string
  /** The error object */
  error: unknown
  /** Error message (extracted) */
  message: string
  /** HTTP status code if available */
  statusCode?: number
  /** Current model when error occurred */
  currentModel?: string
  /** Agent name if available */
  agent?: string
}

/**
 * Result of a fallback attempt
 */
export interface FallbackResult {
  /** Whether the fallback was successful */
  success: boolean
  /** The model switched to (if successful) */
  newModel?: string
  /** Error message (if failed) */
  error?: string
  /** Whether max attempts were reached */
  maxAttemptsReached?: boolean
}

/**
 * Options for creating the runtime fallback hook
 */
export interface RuntimeFallbackOptions {
  /** Runtime fallback configuration */
  config?: RuntimeFallbackConfig
  /** Optional plugin config override (primarily for testing) */
  pluginConfig?: OhMyOpenCodeConfig
}

export interface RuntimeFallbackHook {
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>
  "chat.message"?: (input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } }, output: { message: { model?: { providerID: string; modelID: string } }; parts?: Array<{ type: string; text?: string }> }) => Promise<void>
}
