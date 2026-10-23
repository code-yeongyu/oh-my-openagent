import type { WebsearchConfig } from "../config/schema"
import { log } from "../shared/logger"
import type { LocalMcpConfig } from "./lsp"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig | LocalMcpConfig | undefined {
  const provider = config?.provider || "exa"

  if (provider === "tavily") {
    const tavilyKey = process.env.TAVILY_API_KEY
    if (!tavilyKey) {
      log("[websearch] Tavily API key not found, skipping websearch MCP")
      return undefined
    }

    return {
      type: "remote" as const,
      url: "https://mcp.tavily.com/mcp/",
      enabled: true,
      headers: {
        Authorization: `Bearer ${tavilyKey}`,
      },
      oauth: false as const,
    }
  }

  if (provider === "volcengine") {
    const volcengineKey = process.env.ASK_ECHO_SEARCH_INFINITY_API_KEY
    if (!volcengineKey) {
      log("[websearch] Volcano Engine API key not found, skipping websearch MCP")
      return undefined
    }

    return {
      type: "local" as const,
      command: [
        "uvx",
        "--from",
        "mcp-server-askecho-search-infinity>=0.2.0",
        "mcp-server-askecho-search-infinity",
      ],
      enabled: true,
      environment: {
        ASK_ECHO_SEARCH_INFINITY_API_KEY: volcengineKey,
      },
    }
  }

  return {
    type: "remote" as const,
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    enabled: true,
    ...(process.env.EXA_API_KEY ? { headers: { Authorization: `Bearer ${process.env.EXA_API_KEY}` } } : {}),
    oauth: false as const,
  }
}

export const websearch = createWebsearchConfig()
