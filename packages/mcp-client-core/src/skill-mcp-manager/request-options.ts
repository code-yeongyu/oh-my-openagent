import type { RequestOptions } from "@modelcontextprotocol/sdk/shared/protocol.js"
import type { ClaudeCodeMcpServer } from "@oh-my-opencode/claude-code-compat-core/claude-code-mcp-loader/types"
import type { SkillMcpClientOptions } from "./manager"

export function resolveRequestTimeoutMs(config: ClaudeCodeMcpServer, options?: SkillMcpClientOptions): number | undefined {
  return options?.requestTimeoutMs ?? config.timeout
}

export function buildRequestOptions(config: ClaudeCodeMcpServer, options?: SkillMcpClientOptions): RequestOptions | undefined {
  const timeout = resolveRequestTimeoutMs(config, options)
  if (timeout === undefined) {
    return undefined
  }
  return { timeout }
}
