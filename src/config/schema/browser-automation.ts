import { z } from "zod"

export const BrowserAutomationProviderSchema = z.enum([
  "playwright",
  "agent-browser",
  "dev-browser",
])

export const BrowserAutomationConfigSchema = z.object({
  /**
   * Browser automation provider to use for the "playwright" skill.
   * - "playwright": Uses Playwright MCP server (@playwright/mcp) - default
   * - "agent-browser": Uses Vercel's agent-browser CLI (requires: bun add -g agent-browser)
   * - "dev-browser": Uses dev-browser skill with persistent browser state
   */
  provider: BrowserAutomationProviderSchema.default("playwright"),
})

export type BrowserAutomationProvider = z.infer<
  typeof BrowserAutomationProviderSchema
>
export type BrowserAutomationConfig = z.infer<typeof BrowserAutomationConfigSchema>
