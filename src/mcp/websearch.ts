import type { ExaTool, WebsearchConfig } from "../config/schema"
import { ExaToolSchema } from "../config/schema"

type RemoteMcpConfig = {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

// Default Exa tools (3 tools for minimal context)
const DEFAULT_EXA_TOOLS: ExaTool[] = [
  "web_search_exa",
  "get_code_context_exa",
  "company_research_exa",
]

// All available Exa tools (8 tools)
const ALL_EXA_TOOLS: ExaTool[] = [
  "web_search_exa",
  "get_code_context_exa",
  "company_research_exa",
  "web_search_advanced_exa",
  "crawling_exa",
  "people_search_exa",
  "deep_researcher_start",
  "deep_researcher_check",
]

function buildExaMcpUrl(tools: ExaTool[], apiKey?: string): string {
  const toolsParam = tools.map((t) => `tools=${encodeURIComponent(t)}`).join("&")
  const baseUrl = "https://mcp.exa.ai/mcp"

  if (apiKey) {
    return `${baseUrl}?${toolsParam}&exaApiKey=${encodeURIComponent(apiKey)}`
  }
  return `${baseUrl}?${toolsParam}`
}

function resolveExaTools(config?: WebsearchConfig): ExaTool[] {
  const exaTools = config?.exa_tools

  // VAL-MCP-002: "default" preset loads 3 default tools
  if (exaTools === "default") {
    return DEFAULT_EXA_TOOLS
  }

  // VAL-MCP-001: "all" preset loads all 8 tools
  if (exaTools === "all") {
    return ALL_EXA_TOOLS
  }

  // VAL-MCP-003: Custom array - use specified tools only
  if (Array.isArray(exaTools) && exaTools.length > 0) {
    // Validate and return the tools
    return exaTools.map((t) => ExaToolSchema.parse(t))
  }

  // VAL-MCP-004: Empty/unconfigured fallback to web_search_exa (backward compatible)
  return ["web_search_exa"]
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

  // Default to Exa - resolve tools based on exa_tools config
  const exaTools = resolveExaTools(config)
  const url = buildExaMcpUrl(exaTools, process.env.EXA_API_KEY)

  return {
    type: "remote" as const,
    url,
    enabled: true,
    ...(process.env.EXA_API_KEY ? { headers: { "x-api-key": process.env.EXA_API_KEY } } : {}),
    oauth: false as const,
  }
}

// Backward compatibility: export static instance using default config
export const websearch = createWebsearchConfig()
