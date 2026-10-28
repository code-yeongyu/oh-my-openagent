import { DEFAULT_REQUEST_TIMEOUT_MSEC } from "@modelcontextprotocol/sdk/shared/protocol.js"

// Connect uses the SDK request budget. Reserve its second half for a legacy
// initialize if discovery is silently ignored, rather than racing that deadline.
export const SKILL_MCP_DISCOVERY_TIMEOUT_MS = DEFAULT_REQUEST_TIMEOUT_MSEC / 2
