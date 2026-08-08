import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { McpRequestTimeoutConfig } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"

function toPositiveMilliseconds(value: number | undefined): number | undefined {
  if (value === undefined) {
    return undefined
  }

  if (!Number.isFinite(value) || value <= 0) {
    return undefined
  }

  return value
}

/**
 * Merges the per-call timeout overrides over the per-server timeout config and
 * maps the result onto the MCP SDK request options.
 *
 * Returns undefined when nothing resolves, so the SDK keeps applying its own
 * DEFAULT_REQUEST_TIMEOUT_MSEC.
 */
export function resolveMcpRequestOptions(
  serverTimeouts: McpRequestTimeoutConfig | undefined,
  callTimeouts?: McpRequestTimeoutConfig
): RequestOptions | undefined {
  const timeout =
    toPositiveMilliseconds(callTimeouts?.requestTimeoutMs) ??
    toPositiveMilliseconds(serverTimeouts?.requestTimeoutMs)
  const maxTotalTimeout =
    toPositiveMilliseconds(callTimeouts?.maxTotalTimeoutMs) ??
    toPositiveMilliseconds(serverTimeouts?.maxTotalTimeoutMs)
  const resetTimeoutOnProgress = callTimeouts?.resetTimeoutOnProgress ?? serverTimeouts?.resetTimeoutOnProgress

  const requestOptions: RequestOptions = {}
  if (timeout !== undefined) {
    requestOptions.timeout = timeout
  }
  if (maxTotalTimeout !== undefined) {
    requestOptions.maxTotalTimeout = maxTotalTimeout
  }
  if (resetTimeoutOnProgress !== undefined) {
    requestOptions.resetTimeoutOnProgress = resetTimeoutOnProgress
  }

  if (Object.keys(requestOptions).length === 0) {
    return undefined
  }

  return requestOptions
}
