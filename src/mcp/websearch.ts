import type { WebsearchConfig } from "../config/schema"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

export function createWebsearchConfig(config?: WebsearchConfig): RemoteMcpConfig {
  const provider = config?.provider || "exa"

  if (provider === "tavily") {
    const tavilyKey = process.env.TAVILY_API_KEY
    if (!tavilyKey) {
      throw new Error("TAVILY_API_KEY environment variable is required for Tavily provider")
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

  // Default to Exa
  // API key passed as query parameter per official docs:
  // https://exa.ai/docs/reference/exa-mcp#opencode
  // https://mcp.exa.ai/mcp?exaApiKey=YOUR_EXA_KEY
  const baseUrl = "https://mcp.exa.ai/mcp?tools=web_search_exa"
  const exaApiKey = process.env.EXA_API_KEY
  const url = exaApiKey ? `${baseUrl}&exaApiKey=${exaApiKey}` : baseUrl

  return {
    type: "remote" as const,
    url,
    enabled: true,
    oauth: false as const,
  }
}

// Backward compatibility: export static instance using default config
export const websearch = createWebsearchConfig()
