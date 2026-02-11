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
  return {
    type: "remote" as const,
    url: process.env.EXA_API_KEY
      ? `https://mcp.exa.ai/mcp?tools=web_search_exa&exaApiKey=${encodeURIComponent(process.env.EXA_API_KEY)}`
      : "https://mcp.exa.ai/mcp?tools=web_search_exa",
    enabled: true,
    ...(process.env.EXA_API_KEY ? { headers: { "x-api-key": process.env.EXA_API_KEY } } : {}),
    oauth: false as const,
  }
}

// Backward compatibility: export static instance using default config
export const websearch = createWebsearchConfig()
