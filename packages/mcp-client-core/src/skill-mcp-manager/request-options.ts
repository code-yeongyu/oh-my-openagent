import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"

// The SDK arms setTimeout with this value; a delay above 2^31-1 ms is clamped to 1 ms.
const MAX_TIMER_DELAY_MS = 2_147_483_647

/**
 * The server's configured request timeout in milliseconds, when it is usable: a finite
 * number in (0, 2^31-1]. Zero, negatives, NaN, Infinity and larger values would arm an
 * immediate or never-firing timer, so they fall back to the SDK default.
 */
export function resolveRequestTimeoutMs(config: ClaudeCodeMcpServer): number | undefined {
  const timeout = config.timeout
  if (typeof timeout !== "number" || !Number.isFinite(timeout)) return undefined
  return timeout > 0 && timeout <= MAX_TIMER_DELAY_MS ? timeout : undefined
}

/** SDK request options for every direct MCP operation: abort signal (#3364) and timeout (#6631). */
export function buildRequestOptions(config: ClaudeCodeMcpServer, scope?: { signal?: AbortSignal }): RequestOptions {
  const timeout = resolveRequestTimeoutMs(config)
  return {
    ...(scope?.signal === undefined ? {} : { signal: scope.signal }),
    ...(timeout === undefined ? {} : { timeout }),
  }
}
