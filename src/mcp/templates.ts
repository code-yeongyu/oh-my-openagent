/**
 * MCP Templates - Predefined MCP configurations that users can activate with just an API key.
 * 
 * This module provides a template-based approach to MCP configuration,
 * allowing users to easily enable popular MCPs without manual URL/header setup.
 */

import { log } from "../shared/logger"

/**
 * Template definition for an MCP server
 */
export interface McpTemplate {
  /** Template identifier */
  name: string
  /** Human-readable description */
  description: string
  /** MCP server URL */
  url: string
  /** Whether authentication is required */
  requiresAuth: boolean
  /** Environment variable name for API key (if auth required) */
  envKey?: string
  /** Header key for API key (if auth required) */
  headerKey?: string
}

/**
 * User configuration to activate an MCP from a template
 */
export interface McpTemplateConfig {
  /** Template name to use */
  template: string
  /** API key (optional if env var is set) */
  apiKey?: string
  /** Override the default URL */
  url?: string
  /** Additional headers */
  headers?: Record<string, string>
}

/**
 * Resolved MCP configuration ready for use
 */
export interface ResolvedMcpConfig {
  type: "remote"
  url: string
  enabled: boolean
  headers?: Record<string, string>
  oauth?: false
}

/**
 * Predefined MCP templates
 */
export const MCP_TEMPLATES: Record<string, McpTemplate> = {
  exa: {
    name: "exa",
    description: "Exa AI web search - real-time web search powered by AI",
    url: "https://mcp.exa.ai/mcp?tools=web_search_exa",
    requiresAuth: true,
    envKey: "EXA_API_KEY",
    headerKey: "x-api-key",
  },
  context7: {
    name: "context7",
    description: "Context7 - fetches up-to-date official documentation for libraries",
    url: "https://mcp.context7.com/mcp",
    requiresAuth: false,
  },
  grep_app: {
    name: "grep_app",
    description: "grep.app - ultra-fast code search across millions of public GitHub repositories",
    url: "https://mcp.grep.app",
    requiresAuth: false,
  },
  tavily: {
    name: "tavily",
    description: "Tavily AI search - AI-powered search engine for LLMs",
    url: "https://mcp.tavily.com/mcp",
    requiresAuth: true,
    envKey: "TAVILY_API_KEY",
    headerKey: "x-api-key",
  },
  firecrawl: {
    name: "firecrawl",
    description: "Firecrawl - web scraping and crawling API",
    url: "https://mcp.firecrawl.dev",
    requiresAuth: true,
    envKey: "FIRECRAWL_API_KEY",
    headerKey: "Authorization",
  },
}

/**
 * Get a template by name
 */
export function getMcpTemplate(name: string): McpTemplate | undefined {
  return MCP_TEMPLATES[name]
}

/**
 * Get all available templates
 */
export function getAllMcpTemplates(): McpTemplate[] {
  return Object.values(MCP_TEMPLATES)
}

/**
 * Resolve an MCP configuration from a template
 * 
 * @param config - Template configuration with optional API key
 * @returns Resolved MCP config ready for use, or undefined if resolution fails
 */
export function resolveMcpFromTemplate(config: McpTemplateConfig): ResolvedMcpConfig | undefined {
  const template = getMcpTemplate(config.template)
  
  if (!template) {
    log(`[MCP Template] Unknown template: ${config.template}`)
    return undefined
  }

  // Determine API key
  let apiKey = config.apiKey
  if (!apiKey && template.requiresAuth && template.envKey) {
    apiKey = process.env[template.envKey]
  }

  // Check if auth is required but not provided
  if (template.requiresAuth && !apiKey) {
    log(`[MCP Template] Template '${template.name}' requires authentication. ` +
      `Set ${template.envKey} environment variable or provide apiKey in config.`)
    return undefined
  }

  // Build headers
  const headers: Record<string, string> = { ...config.headers }
  if (apiKey && template.headerKey) {
    headers[template.headerKey] = apiKey
  }

  return {
    type: "remote",
    url: config.url ?? template.url,
    enabled: true,
    headers: Object.keys(headers).length > 0 ? headers : undefined,
    oauth: false,
  }
}

/**
 * Resolve multiple MCP templates from configuration
 */
export function resolveMcpTemplates(
  templates: Record<string, McpTemplateConfig | string>
): Record<string, ResolvedMcpConfig> {
  const resolved: Record<string, ResolvedMcpConfig> = {}

  for (const [name, config] of Object.entries(templates)) {
    // Support shorthand: { "myexa": "exa" } means use exa template with env var
    const templateConfig: McpTemplateConfig = typeof config === "string"
      ? { template: config }
      : config

    const mcpConfig = resolveMcpFromTemplate(templateConfig)
    if (mcpConfig) {
      resolved[name] = mcpConfig
    }
  }

  return resolved
}
