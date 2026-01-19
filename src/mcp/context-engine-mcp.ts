/**
 * Context-Engine MCP configuration for desktop usage.
 * 
 * This provides a fallback HTTP remote MCP config for context-engine.
 * If users have context-engine configured in their opencode.json with
 * a local command (bridge), that takes precedence.
 * 
 * Environment variables:
 * - CONTEXT_ENGINE_URL: Override the default URL (default: http://127.0.0.1:30810/mcp)
 * - CONTEXT_ENGINE_ENABLED: Set to "false" to disable (default: true)
 */
export const context_engine_mcp = {
  type: "remote" as const,
  url: process.env.CONTEXT_ENGINE_URL ?? "http://127.0.0.1:30810/mcp",
  enabled: process.env.CONTEXT_ENGINE_ENABLED !== "false",
  oauth: false as const,
}

export const MCP_NAME = "context-engine"
