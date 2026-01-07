/**
 * Debug Tracer Constants
 */

import * as os from "os"
import * as path from "path"

/** Environment variable to enable debug tracing */
export const DEBUG_ENV_VAR = "OMO_DEBUG"

/** Environment variable to set log file path */
export const DEBUG_LOG_PATH_VAR = "OMO_DEBUG_LOG"

/** Default ring buffer size */
export const DEFAULT_RING_BUFFER_SIZE = 1000

/** Default flush interval (5 seconds) */
export const DEFAULT_FLUSH_INTERVAL_MS = 5000

/** Default log file name */
export const DEFAULT_LOG_FILENAME = "oh-my-opencode-trace.jsonl"

/** Get default log directory */
export function getDefaultLogDir(): string {
  // Use temp directory for crash-safe writes
  return os.tmpdir()
}

/** Get default log file path */
export function getDefaultLogFilePath(): string {
  return path.join(getDefaultLogDir(), DEFAULT_LOG_FILENAME)
}

/** Patterns to redact in logs */
export const REDACTION_PATTERNS = [
  // API keys and tokens
  /(?:api[_-]?key|token|secret|password|auth|bearer|credential)[\s:=]+["']?[\w\-._~+/]+=*["']?/gi,
  // Common API key formats
  /sk-[a-zA-Z0-9]{32,}/g,
  /xai-[a-zA-Z0-9]{32,}/g,
  /AIza[a-zA-Z0-9_-]{35}/g,
  // Bearer tokens
  /Bearer\s+[a-zA-Z0-9\-._~+/]+=*/gi,
  // GitHub tokens
  /gh[pousr]_[A-Za-z0-9_]{36,}/g,
  // npm tokens
  /npm_[A-Za-z0-9]{36,}/g,
]

/** Environment variables to always redact */
export const REDACTED_ENV_VARS = new Set([
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "GOOGLE_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "NPM_TOKEN",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AZURE_CLIENT_SECRET",
  "DATABASE_URL",
  "REDIS_URL",
  "MONGODB_URI",
])

/** Command arguments that should be redacted */
export const REDACTED_ARG_PATTERNS = [
  /--token[=\s]/i,
  /--password[=\s]/i,
  /--secret[=\s]/i,
  /--key[=\s]/i,
  /--auth[=\s]/i,
]
