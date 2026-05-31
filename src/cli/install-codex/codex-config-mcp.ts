import { appendBlock, findTomlSection } from "./toml-section-editor"

const CONTEXT7_MCP_SERVER_HEADER = "mcp_servers.context7"
const CONTEXT7_MCP_SERVER_BLOCK = [
  `[${CONTEXT7_MCP_SERVER_HEADER}]`,
  'command = "npx"',
  'args = ["-y", "@upstash/context7-mcp", "--api-key", "YOUR_API_KEY"]',
  "startup_timeout_sec = 20",
  "",
].join("\n")

export function ensureContext7McpServer(config: string): string {
  if (findTomlSection(config, CONTEXT7_MCP_SERVER_HEADER)) return config
  return appendBlock(config, CONTEXT7_MCP_SERVER_BLOCK)
}
