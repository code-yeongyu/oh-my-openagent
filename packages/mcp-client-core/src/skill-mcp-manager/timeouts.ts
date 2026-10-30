import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js"
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js"

// Connect uses the SDK request budget. Reserve its second half for a legacy
// initialize if discovery is silently ignored, rather than racing that deadline.
export const SKILL_MCP_DISCOVERY_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MSEC / 2

// The legacy SSE transport's start() waits for the server's endpoint event with no deadline of
// its own, so its whole connect gets the same SDK request budget as a Streamable HTTP connect.
export async function withConnectDeadline(connect: Promise<void>): Promise<void> {
  const expired = Promise.withResolvers<never>()
  const timer = setTimeout(() => expired.reject(
    new McpError(ErrorCode.RequestTimeout, "Request timed out", { timeout: DEFAULT_REQUEST_TIMEOUT_MSEC }),
  ), DEFAULT_REQUEST_TIMEOUT_MSEC)
  try {
    await Promise.race([connect, expired.promise])
  } finally {
    clearTimeout(timer)
  }
}
