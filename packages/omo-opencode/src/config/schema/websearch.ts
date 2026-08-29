import { z } from "zod"

export const WebsearchProviderSchema = z.enum(["exa", "tavily", "parallel"])

export const WebsearchConfigSchema = z.object({
  /**
   * Websearch provider to use.
   * - "exa": Uses Exa websearch (default, works without API key)
   * - "tavily": Uses Tavily websearch (requires TAVILY_API_KEY)
   * - "parallel": Uses Parallel Search MCP (no account or API key required)
   */
  provider: WebsearchProviderSchema.optional(),
})

export type WebsearchProvider = z.infer<typeof WebsearchProviderSchema>
export type WebsearchConfig = z.infer<typeof WebsearchConfigSchema>
