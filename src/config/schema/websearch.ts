import { z } from "zod"

export const WebsearchProviderSchema = z.enum(["exa", "tavily"])

export const ExaToolSchema = z.enum([
  "web_search_exa",
  "get_code_context_exa",
  "company_research_exa",
  "web_search_advanced_exa",
  "crawling_exa",
  "people_search_exa",
  "deep_researcher_start",
  "deep_researcher_check",
])

export const WebsearchConfigSchema = z.object({
  /**
   * Websearch provider to use.
   * - "exa": Uses Exa websearch (default, works without API key)
   * - "tavily": Uses Tavily websearch (requires TAVILY_API_KEY)
   */
  provider: WebsearchProviderSchema.optional(),
  /**
   * Exa tools to load. Only applies when provider is "exa".
   * - "all": Load all 8 Exa tools
   * - "default": Load 3 default tools (web_search, code_context, company_research)
   * - string[]: Select specific tools
   * Default: ["web_search_exa"] (backward compatible, minimal context)
   */
  exa_tools: z.union([
    z.array(ExaToolSchema),
    z.literal("all"),
    z.literal("default"),
  ]).optional(),
})

export type WebsearchProvider = z.infer<typeof WebsearchProviderSchema>
export type ExaTool = z.infer<typeof ExaToolSchema>
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>
